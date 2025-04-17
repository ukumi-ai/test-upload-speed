"use client";
import React, {
  useState,
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
} from "react";
import { X, Upload, Check, Clock } from "lucide-react";
import axios from "axios";

// Define enum for file status
enum FileStatus {
  IDLE = "idle",
  UPLOADING = "uploading",
  COMPLETED = "completed",
  ERROR = "error",
}

// Type for tab selection
type TabType = "zoom" | "riverside";
type VideoSource = "zoom" | "river1" | "river2";
type UploadType = "standard" | "accelerated";

// Interface for file with status
interface FileWithStatus {
  file: File;
  status: FileStatus;
  progress: number; // 0-100
  id: string; // unique id for each file
  url?: string; // S3 URL after upload
  videoSource: VideoSource;
}

// Props interface for the FileUploadComponent
interface FileUploadComponentProps {
  title: string;
  uploadType: UploadType;
  onZoomFileChange: (
    files:
      | FileWithStatus[]
      | ((prevFiles: FileWithStatus[]) => FileWithStatus[])
  ) => void;
  onRiversideFilesChange: (
    files:
      | FileWithStatus[]
      | ((prevFiles: FileWithStatus[]) => FileWithStatus[])
  ) => void;
  zoomFiles: FileWithStatus[];
  riversideFiles: FileWithStatus[];
}

// Constants for chunked upload
const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

const FileUploadComponent: React.FC<FileUploadComponentProps> = ({
  title,
  uploadType,
  onZoomFileChange,
  onRiversideFilesChange,
  zoomFiles,
  riversideFiles,
}) => {
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabType>("zoom");
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadStartTime, setUploadStartTime] = useState<number | null>(null);
  const [uploadEndTime, setUploadEndTime] = useState<number | null>(null);
  const [uploadDuration, setUploadDuration] = useState<string | null>(null);

  const maxSize: number = 5 * 1024 * 1024 * 1024; // 5GB in bytes
  const allowedFormats: string[] = [
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
  ]; // mp4, mov, avi

  // Update upload duration when upload completes
  useEffect(() => {
    if (uploadStartTime && uploadEndTime) {
      const duration = uploadEndTime - uploadStartTime;
      const seconds = Math.floor(duration / 1000);
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      setUploadDuration(`${minutes}m ${remainingSeconds}s`);
    }
  }, [uploadStartTime, uploadEndTime]);

  // Validate file format and size
  const validateFile = (file: File): boolean => {
    if (!allowedFormats.includes(file.type)) {
      return false;
    }

    if (file.size > maxSize) {
      return false;
    }

    return true;
  };

  // Create a new FileWithStatus object from a File
  const createFileWithStatus = (
    file: File,
    videoSource: VideoSource
  ): FileWithStatus => {
    return {
      file,
      status: FileStatus.IDLE,
      progress: 0,
      id: `${file.name}-${Date.now()}`,
      videoSource,
    };
  };

  // Handle file change for Zoom tab (single file)
  const handleZoomFileChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setError("");
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (!validateFile(file)) {
        setError(
          `Invalid file format or size. Please upload MP4, MOV, or AVI files under 5GB.`
        );
        return;
      }
      onZoomFileChange([createFileWithStatus(file, "zoom")]);
    }
  };

  // Handle file change for Riverside tab (multiple files)
  const handleRiversideFileChange = (
    e: ChangeEvent<HTMLInputElement>
  ): void => {
    setError("");
    const files = e.target.files;
    if (!files) return;

    const fileArray = Array.from(files);
    const validFiles = fileArray.filter((file) => validateFile(file));

    if (validFiles.length !== fileArray.length) {
      setError(`Some files have invalid format or exceed the 5GB size limit.`);
    }

    // Only take up to 2 files for Riverside
    const filesToAdd = validFiles.slice(0, 2);

    // If we already have some files, only add new ones up to the limit of 2
    const currentFiles = riversideFiles || [];
    const availableSlots = 2 - currentFiles.length;

    if (availableSlots > 0) {
      const newFilesWithStatus = filesToAdd
        .slice(0, availableSlots)
        .map((file, index) => {
          // Determine if this is river1 or river2 based on existing files
          let videoSource: VideoSource = "river1";

          // If we already have a river1 file, this should be river2
          if (currentFiles.some((f) => f.videoSource === "river1")) {
            videoSource = "river2";
          }

          // If this is the second file we're adding at once
          if (index === 1 && filesToAdd.length > 1) {
            videoSource = "river2";
          }

          return createFileWithStatus(file, videoSource);
        });

      onRiversideFilesChange([...currentFiles, ...newFilesWithStatus]);
    } else {
      setError("You've already uploaded the maximum of 2 files.");
    }
  };

  // Handle drag over event
  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragActive(true);
  };

  // Handle drag leave event
  const handleDragLeave = (): void => {
    setDragActive(false);
  };

  // Handle file drop event
  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragActive(false);
    setError("");

    const fileList = e.dataTransfer.files;
    if (!fileList) return;

    if (activeTab === "zoom") {
      const file = fileList[0];
      if (!file) return;

      if (!validateFile(file)) {
        setError(
          `Invalid file format or size. Please upload MP4, MOV, or AVI files under 5GB.`
        );
        return;
      }

      onZoomFileChange([createFileWithStatus(file, "zoom")]);
    } else {
      // Riverside - can accept up to 2 files
      const fileArray = Array.from(fileList);
      const validFiles = fileArray.filter((file) => validateFile(file));

      if (validFiles.length !== fileArray.length) {
        setError(
          `Some files have invalid format or exceed the 5GB size limit.`
        );
      }

      // Only take up to the number of available slots
      const currentFiles = riversideFiles || [];
      const availableSlots = 2 - currentFiles.length;

      if (availableSlots > 0) {
        const newFilesWithStatus = validFiles
          .slice(0, availableSlots)
          .map((file, index) => {
            // Determine if this is river1 or river2 based on existing files
            let videoSource: VideoSource = "river1";

            // If we already have a river1 file, this should be river2
            if (currentFiles.some((f) => f.videoSource === "river1")) {
              videoSource = "river2";
            }

            // If this is the second file we're adding at once
            if (index === 1 && validFiles.length > 1) {
              videoSource = "river2";
            }

            return createFileWithStatus(file, videoSource);
          });

        onRiversideFilesChange([...currentFiles, ...newFilesWithStatus]);
      } else {
        setError("You've already uploaded the maximum of 2 files.");
      }
    }
  };

  // Remove a file by id
  const removeFile = (id: string): void => {
    if (activeTab === "zoom") {
      onZoomFileChange([]);
    } else {
      const updatedFiles = riversideFiles.filter(
        (fileItem) => fileItem.id !== id
      );
      onRiversideFilesChange(updatedFiles);
    }
  };

  // Reset all files and upload state
  const resetFiles = (): void => {
    if (activeTab === "zoom") {
      onZoomFileChange([]);
    } else {
      onRiversideFilesChange([]);
    }
    setError("");
    setIsUploading(false);
    setUploadStartTime(null);
    setUploadEndTime(null);
    setUploadDuration(null);
  };

  // Handle tab change
  const handleTabChange = (tab: TabType): void => {
    setActiveTab(tab);
    setError("");
  };

  // Get active files based on current tab
  const getActiveFiles = useCallback((): FileWithStatus[] => {
    return activeTab === "zoom" ? zoomFiles : riversideFiles;
  }, [activeTab, zoomFiles, riversideFiles]);

  // Update file progress
  const updateFileProgress = useCallback(
    (
      fileId: string,
      progress: number,
      status?: FileStatus,
      url?: string
    ): void => {
      if (activeTab === "zoom") {
        onZoomFileChange((prevFiles: FileWithStatus[]) =>
          prevFiles.map((item) =>
            item.id === fileId
              ? {
                  ...item,
                  progress,
                  status: status || item.status,
                  url: url || item.url,
                }
              : item
          )
        );
      } else {
        onRiversideFilesChange((prevFiles: FileWithStatus[]) =>
          prevFiles.map((item) =>
            item.id === fileId
              ? {
                  ...item,
                  progress,
                  status: status || item.status,
                  url: url || item.url,
                }
              : item
          )
        );
      }
    },
    [activeTab, onZoomFileChange, onRiversideFilesChange]
  );

  // Format filename to be S3 friendly
  const cleanFileName = (filename: string): string => {
    // First split the filename into name and extension
    const lastDotIndex = filename.lastIndexOf(".");
    if (lastDotIndex === -1) {
      // No extension
      return filename.trim().replace(/\s+/g, "-");
    }

    const name = filename.substring(0, lastDotIndex);
    const extension = filename.substring(lastDotIndex);

    // Clean the name (replace spaces with dashes)
    const cleanName = name.trim().replace(/\s+/g, "-");

    // Clean the extension (remove spaces)
    const cleanExtension = extension.replace(/\s+/g, "");

    return cleanName + cleanExtension;
  };

  // Initiate upload for a single file
// Initiate upload for a single file with parallel chunk uploading
const uploadFile = async (fileItem: FileWithStatus): Promise<string> => {
  const file = fileItem.file;
  const videoSource = fileItem.videoSource;
  const PARALLEL_UPLOADS = 10; // Number of chunks to upload in parallel

  try {
    // Update file status to uploading
    updateFileProgress(fileItem.id, 0, FileStatus.UPLOADING);

    // Clean the filename for S3
    const cleanedFileName = cleanFileName(file.name);

    // Calculate part count
    const partCount = Math.ceil(file.size / CHUNK_SIZE);

    console.log("Initiating upload with params:", {
      action: "initUpload",
      videoSource,
      uploadType,
      fileName: cleanedFileName,
      contentType: file.type,
      partCount,
    });

    // Initiate upload
    const initiateResponse = await axios.post("/api/upload", {
      action: "initUpload",
      videoSource,
      uploadType,
      fileName: cleanedFileName,
      contentType: file.type,
      partCount,
    });

    console.log("Initiate response:", initiateResponse.data);

    const { uploadId, key, urls } = initiateResponse.data;

    // Upload parts in parallel batches
    const uploadedParts: { ETag: string; PartNumber: number }[] = [];
    let completedChunks = 0;

    // Process chunks in batches of PARALLEL_UPLOADS
    for (let batchStart = 0; batchStart < partCount; batchStart += PARALLEL_UPLOADS) {
      const batchEnd = Math.min(batchStart + PARALLEL_UPLOADS, partCount);
      const batchPromises = [];

      // Create batch of upload promises
      for (let i = batchStart; i < batchEnd; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(file.size, (i + 1) * CHUNK_SIZE);
        const chunkData = file.slice(start, end);
        const partNumber = i + 1;

        const uploadPromise = axios.put(urls[i], chunkData, {
          headers: {
            "Content-Type": "application/octet-stream",
          },
        })
        .then(uploadResponse => {
          // Extract ETag (removing quotes if necessary)
          let etag = uploadResponse.headers.etag;
          if (etag) {
            // Remove quotes if they exist
            etag = etag.replace(/"/g, "");
          } else {
            console.error("No ETag found in response headers", uploadResponse.headers);
            throw new Error("No ETag found in response");
          }

          // Track completed chunk
          completedChunks++;
          
          // Update progress (safely handle potential race conditions)
          const progress = Math.round((completedChunks / partCount) * 100);
          updateFileProgress(fileItem.id, progress);

          return {
            ETag: etag,
            PartNumber: partNumber,
          };
        });

        batchPromises.push(uploadPromise);
      }

      try {
        // Wait for the current batch to complete
        const batchResults = await Promise.all(batchPromises);
        uploadedParts.push(...batchResults);
      } catch (error) {
        console.error(`Failed to upload batch starting at ${batchStart}:`, error);
        
        // Try to abort the upload before throwing
        try {
          await axios.post("/api/upload", {
            action: "abortUpload",
            videoSource,
            uploadType,
            uploadId,
            key,
          });
          console.log("Upload aborted due to batch failure");
        } catch (abortError) {
          console.error("Failed to abort upload:", abortError);
        }
        
        throw error;
      }
    }

    console.log("All parts uploaded, completing upload with:", {
      action: "completeUpload",
      videoSource,
      uploadType,
      uploadId,
      key,
      parts: uploadedParts,
    });

    // Complete the upload
    const completeResponse = await axios.post("/api/upload", {
      action: "completeUpload",
      videoSource,
      uploadType,
      uploadId,
      key,
      parts: uploadedParts.sort((a, b) => a.PartNumber - b.PartNumber),
    });

    console.log("Complete response:", completeResponse.data);

    const { url } = completeResponse.data;

    // Update file with completed status and url
    updateFileProgress(fileItem.id, 100, FileStatus.COMPLETED, url);

    return url;
  } catch (error) {
    console.error("Upload error:", error);
    if (axios.isAxiosError(error)) {
      console.error("Response data:", error.response?.data);
      console.error("Response status:", error.response?.status);
      console.error("Response headers:", error.response?.headers);
    }
    updateFileProgress(fileItem.id, fileItem.progress, FileStatus.ERROR);
    throw error;
  }
};

  // Start uploading all files
  const startUpload = async (): Promise<void> => {
    setError("");
    setIsUploading(true);
    setUploadStartTime(Date.now());
    setUploadEndTime(null);
    setUploadDuration(null);

    const files = getActiveFiles();

    try {
      if (activeTab === "zoom") {
        // For Zoom, we just have one file
        if (files.length === 1) {
          await uploadFile(files[0]);
        }
      } else {
        // For Riverside, upload all files (up to 2)
        await Promise.all(files.map((fileItem) => uploadFile(fileItem)));
      }

      // All uploads completed successfully
      setUploadEndTime(Date.now());
    } catch (err) {
      console.error("Upload failed:", err);
      setError("Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  // Check if all files are completed
  const areAllFilesUploaded = useCallback((): boolean => {
    const files = getActiveFiles();
    return (
      files.length > 0 &&
      files.every((file) => file.status === FileStatus.COMPLETED)
    );
  }, [getActiveFiles]);

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-semibold text-primary-base">{title}</h2>
        {uploadDuration && areAllFilesUploaded() && (
          <div className="text-sm font-medium text-tertiary-text-success flex items-center">
            <Clock size={16} className="mr-1" />
            Completed in {uploadDuration}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex mb-4">
        <button
          className={`flex-1 py-2 ${
            activeTab === "zoom"
              ? "bg-black text-white"
              : "bg-secondary-surface-base text-primary-base"
          }`}
          onClick={() => handleTabChange("zoom")}
          disabled={isUploading}
        >
          Zoom
        </button>
        <button
          className={`flex-1 py-2 ${
            activeTab === "riverside"
              ? "bg-black text-white"
              : "bg-secondary-surface-base text-primary-base"
          }`}
          onClick={() => handleTabChange("riverside")}
          disabled={isUploading}
        >
          Riverside
        </button>
      </div>

      {/* Upload Area */}
      <div
        className={`border-2 border-dashed rounded-lg p-6 ${
          dragActive
            ? "border-primary-DEFAULT bg-secondary-brand-tertiary"
            : "border-secondary-border"
        } ${
          getActiveFiles().length > 0 ? "pt-4 pb-4 px-4" : "text-center"
        } mb-4`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {getActiveFiles().length > 0 ? (
          <div className="w-full">
            {getActiveFiles().map((fileItem) => (
              <div
                key={fileItem.id}
                className="mb-4 bg-gray-50 rounded-lg p-3 relative"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 pr-10">
                    <div className="flex items-center">
                      <p className="font-medium truncate">
                        {fileItem.file.name}
                      </p>
                      <span className="ml-2 px-2 py-0.5 bg-gray-200 text-xs rounded-full">
                        {fileItem.videoSource}
                      </span>
                    </div>
                    <p className="text-sm text-secondary-base">
                      {(fileItem.file.size / (1024 * 1024)).toFixed(2)} MB
                    </p>

                    {/* Progress bar */}
                    <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                      <div
                        className={`h-2 rounded-full ${
                          fileItem.status === FileStatus.ERROR
                            ? "bg-red-500"
                            : fileItem.status === FileStatus.COMPLETED
                            ? "bg-green-500"
                            : "bg-primary-DEFAULT"
                        }`}
                        style={{ width: `${fileItem.progress}%` }}
                      ></div>
                    </div>

                    {/* Status indicator */}
                    <div className="flex items-center mt-1">
                      {fileItem.status === FileStatus.UPLOADING && (
                        <p className="text-xs text-blue-600 flex items-center">
                          <Upload size={12} className="mr-1 animate-pulse" />
                          Uploading ({fileItem.progress}%)
                        </p>
                      )}
                      {fileItem.status === FileStatus.COMPLETED && (
                        <p className="text-xs text-green-600 flex items-center">
                          <Check size={12} className="mr-1" />
                          Upload complete
                        </p>
                      )}
                      {fileItem.status === FileStatus.ERROR && (
                        <p className="text-xs text-red-600">Upload failed</p>
                      )}
                    </div>
                  </div>

                  {/* Remove button */}
                  {!isUploading && (
                    <button
                      onClick={() => removeFile(fileItem.id)}
                      className="absolute top-3 right-3 text-gray-500 hover:text-red-500"
                      aria-label="Remove file"
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* "Add another file" button for Riverside when fewer than 2 files */}
            {activeTab === "riverside" &&
              riversideFiles.length < 2 &&
              !isUploading && (
                <div className="text-center mt-3">
                  <label className="inline-block bg-black hover:bg-gray-800 text-white px-4 py-2 rounded cursor-pointer">
                    Add Another File
                    <input
                      type="file"
                      accept=".mp4,.mov,.avi"
                      onChange={handleRiversideFileChange}
                      className="hidden"
                    />
                  </label>
                </div>
              )}
          </div>
        ) : (
          <div className="text-center">
            <p className="mb-2">
              Drag & drop{" "}
              {activeTab === "riverside" ? "up to 2 files" : "a file"} here, or
            </p>
            <label className="bg-black hover:bg-gray-800 text-white px-4 py-2 rounded cursor-pointer inline-block">
              Choose {activeTab === "riverside" ? "Files" : "File"}
              <input
                type="file"
                accept=".mp4,.mov,.avi"
                onChange={
                  activeTab === "zoom"
                    ? handleZoomFileChange
                    : handleRiversideFileChange
                }
                multiple={activeTab === "riverside"}
                className="hidden"
              />
            </label>

            <p className="text-sm text-muted-tertiary mt-4">
              Accepted formats: MP4, MOV, AVI (Max 5GB each)
              {activeTab === "riverside" && (
                <span className="block mt-1">
                  For Riverside, you can upload up to 2 files
                </span>
              )}
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-100 text-red-700 p-3 rounded mb-4">{error}</div>
      )}

      <div className="flex space-x-4">
        <button
          className="flex-1 bg-black hover:bg-gray-800 text-white py-2 px-4 rounded disabled:opacity-50 flex items-center justify-center"
          disabled={
            getActiveFiles().length === 0 ||
            isUploading ||
            areAllFilesUploaded()
          }
          onClick={startUpload}
        >
          {isUploading ? (
            <>
              <Upload className="animate-pulse mr-2" size={18} />
              Uploading...
            </>
          ) : areAllFilesUploaded() ? (
            <>
              <Check className="mr-2" size={18} />
              Upload Complete
            </>
          ) : (
            "Start Upload"
          )}
        </button>
        <button
          className="bg-secondary-surface-base text-primary-base hover:bg-secondary-border py-2 px-4 rounded border border-secondary-border disabled:opacity-50"
          onClick={resetFiles}
          disabled={isUploading}
        >
          Reset
        </button>
      </div>
    </div>
  );
};

const FileUploadTestPage: React.FC = () => {
  // State for Standard bucket test
  const [standardZoomFiles, setStandardZoomFiles] = useState<FileWithStatus[]>(
    []
  );
  const [standardRiversideFiles, setStandardRiversideFiles] = useState<
    FileWithStatus[]
  >([]);

  // State for Accelerated bucket test
  const [acceleratedZoomFiles, setAcceleratedZoomFiles] = useState<
    FileWithStatus[]
  >([]);
  const [acceleratedRiversideFiles, setAcceleratedRiversideFiles] = useState<
    FileWithStatus[]
  >([]);

  return (
    <div className="min-h-screen bg-tertiary-surface-base p-8">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-md overflow-hidden">
        <div className="px-6 py-4">
          <h1 className="text-2xl font-bold text-center mb-6 text-primary-DEFAULT">
            Upload Speed Test
          </h1>

          {/* Standard Bucket Test Upload Component */}
          <FileUploadComponent
            title="Standard Bucket Test"
            uploadType="standard"
            onZoomFileChange={setStandardZoomFiles}
            onRiversideFilesChange={setStandardRiversideFiles}
            zoomFiles={standardZoomFiles}
            riversideFiles={standardRiversideFiles}
          />

          {/* Accelerated Bucket Test Upload Component */}
          <FileUploadComponent
            title="Accelerated Bucket Test"
            uploadType="accelerated"
            onZoomFileChange={setAcceleratedZoomFiles}
            onRiversideFilesChange={setAcceleratedRiversideFiles}
            zoomFiles={acceleratedZoomFiles}
            riversideFiles={acceleratedRiversideFiles}
          />
        </div>
      </div>
    </div>
  );
};

export default FileUploadTestPage;
