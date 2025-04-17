// File: app/api/upload/route.ts
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Validate and get environment variables
const getEnvVar = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const AWS_REGION = getEnvVar('AWS_REGION');
const AWS_ACCESS_KEY_ID = getEnvVar('AWS_ACCESS_KEY_ID');
const AWS_SECRET_ACCESS_KEY = getEnvVar('AWS_SECRET_ACCESS_KEY');

// New environment variables for specific S3 buckets
const S3_BUCKETS = {
  zoom: {
    standard: process.env.S3_STANDARD_ZOOM_BUCKET,
    accelerated: process.env.S3_ACCEL_ZOOM_BUCKET
  },
  river1: {
    standard: process.env.S3_STANDARD_RIVER1_BUCKET,
    accelerated: process.env.S3_ACCEL_RIVER1_BUCKET
  },
  river2: {
    standard: process.env.S3_STANDARD_RIVER2_BUCKET,
    accelerated: process.env.S3_ACCEL_RIVER2_BUCKET
  }
};

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  }
});

const getBucketName = (
  videoSource: string, 
  uploadType: 'standard' | 'accelerated' = 'standard'
): string => {
  // Validate inputs
  if (!['zoom', 'river1', 'river2'].includes(videoSource)) {
    throw new Error(`Invalid video source: ${videoSource}`);
  }

  if (!['standard', 'accelerated'].includes(uploadType)) {
    throw new Error(`Invalid upload type: ${uploadType}`);
  }

  // Get the specific bucket based on video source and upload type
  const bucket = S3_BUCKETS[videoSource as keyof typeof S3_BUCKETS][uploadType];

  if (!bucket) {
    throw new Error(`No bucket configured for source: ${videoSource}, type: ${uploadType}`);
  }

  return bucket;
};

const initializeMultipartUpload = async (bucketName: string, key: string, contentType: string) => {
  const command = new CreateMultipartUploadCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
  });

  const { UploadId } = await s3Client.send(command);
  return UploadId;
};

const generatePresignedUrls = async (bucketName: string, key: string, uploadId: string, partCount: number) => {
  const urlPromises = Array.from({ length: partCount }, (_, i) => {
    const command = new UploadPartCommand({
      Bucket: bucketName,
      Key: key,
      UploadId: uploadId,
      PartNumber: i + 1,
    });

    return getSignedUrl(s3Client, command, {
      expiresIn: 3600,
      signableHeaders: new Set(['host']),
    });
  });

  return Promise.all(urlPromises);
};

const completeMultipartUpload = async (bucketName: string, key: string, uploadId: string, parts: { ETag: string, PartNumber: number }[]) => {
  const command = new CompleteMultipartUploadCommand({
    Bucket: bucketName,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts },
  });

  await s3Client.send(command);
};

const abortMultipartUpload = async (bucketName: string, key: string, uploadId: string) => {
  const command = new AbortMultipartUploadCommand({
    Bucket: bucketName,
    Key: key,
    UploadId: uploadId,
  });

  await s3Client.send(command);
};

// App Router format for POST handler
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      action, 
      videoSource, 
      uploadType = 'standard', 
      fileName, 
      contentType, 
      uploadId, 
      partCount, 
      parts, 
      key 
    } = body;

    if (!videoSource) {
      return NextResponse.json({ error: 'Invalid videoSource' }, { status: 400 });
    }

    const bucketName = getBucketName(videoSource, uploadType);

    if (action === 'initUpload') {
      if (!fileName) {
        return NextResponse.json({ error: 'Invalid fileName' }, { status: 400 });
      }
      if (!contentType) {
        return NextResponse.json({ error: 'Invalid contentType' }, { status: 400 });
      }
      if (typeof partCount !== 'number' || partCount <= 0) {
        return NextResponse.json({ error: 'Invalid partCount' }, { status: 400 });
      }
      
      // Generate a unique key with timestamp, UUID, and original filename
      const newKey = `${Date.now()}-${uuidv4()}-${fileName}`;
      
      // Initialize multipart upload with the specific bucket
      const newUploadId = await initializeMultipartUpload(bucketName, newKey, contentType);
      
      // Generate presigned URLs for parts
      const urls = await generatePresignedUrls(bucketName, newKey, newUploadId as string, partCount);
      
      return NextResponse.json({ 
        uploadId: newUploadId, 
        key: newKey, 
        urls,
      });
    }
    else if (action === 'completeUpload') {
      if (!key) {
        return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
      }
      if (!uploadId) {
        return NextResponse.json({ error: 'Invalid uploadId' }, { status: 400 });
      }
      if (!Array.isArray(parts) || parts.some(part => typeof part.ETag !== 'string' || typeof part.PartNumber !== 'number')) {
        return NextResponse.json({ error: 'Invalid parts' }, { status: 400 });
      }
      
      await completeMultipartUpload(bucketName, key, uploadId, parts);
      
      // Construct file URL based on the specific bucket
      const fileUrl = `https://${bucketName}/${key}`;
      
      return NextResponse.json({ 
        url: fileUrl,
      });
    }
    else if (action === 'abortUpload') {
      if (!key) {
        return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
      }
      if (!uploadId) {
        return NextResponse.json({ error: 'Invalid uploadId' }, { status: 400 });
      }
      
      await abortMultipartUpload(bucketName, key, uploadId);
      
      return NextResponse.json({ 
        message: 'Upload aborted successfully',
      });
    }
    else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Error in API route:', error);
    return NextResponse.json({ 
      error: 'Internal server error', 
      details: (error instanceof Error) ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}