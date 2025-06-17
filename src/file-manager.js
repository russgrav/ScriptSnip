export class FileManager {
  constructor() {
    this.videoExtensions = new Set([
      '.mkv', '.mp4', '.webm', '.mpg', '.mp2', '.mpeg', '.mpe', '.mpv',
      '.ogg', '.m4p', '.m4v', '.avi', '.wmv', '.mov', '.qt', '.flv',
      '.swf', '.mp3', '.wav', '.flac', '.m4a', '.aac'
    ]);

    this.subtitleExtensions = new Set([
      '.srt', '.ass', '.ssa', '.vtt'
    ]);
  }

  /**
   * Check if file is a video file (matches Python video_exts)
   */
  isVideoFile(file) {
    const extension = this.getFileExtension(file.name);
    return this.videoExtensions.has(extension);
  }

  /**
   * Check if file is a subtitle file (matches Python sub_exts)
   */
  isSubtitleFile(file) {
    const extension = this.getFileExtension(file.name);
    return this.subtitleExtensions.has(extension);
  }

  /**
   * Find subtitle file with same name as video (port from Python find_subtitle_with_same_name_as_file)
   */
  findSubtitleWithSameName(videoFile, allFiles, config) {
    const baseName = this.getBaseName(videoFile.name);
    
    // Check for files with sub_suffix (Python logic)
    for (const ext of this.subtitleExtensions) {
      const subtitleName = baseName + config.subSuffix + ext;
      const matchingFile = allFiles.find(f => f.name === subtitleName);
      if (matchingFile) {
        return matchingFile;
      }
    }
    
    return null;
  }

  /**
   * Find matching subtitles for video files (port from Python find_matching_subtitles_for_files)
   */
  findMatchingSubtitles(videoFiles, allFiles, config) {
    const matches = [];
    const invalidVideos = [];

    for (const videoFile of videoFiles) {
      const subtitle = this.findSubtitleWithSameName(videoFile, allFiles, config);
      matches.push(subtitle);
      
      if (!subtitle) {
        invalidVideos.push(videoFile);
      }
    }

    return { matches, invalidVideos };
  }

  /**
   * Validate file selection
   */
  validateFiles(files) {
    const videoFiles = [];
    const subtitleFiles = [];
    const invalidFiles = [];

    for (const file of files) {
      if (this.isVideoFile(file)) {
        videoFiles.push(file);
      } else if (this.isSubtitleFile(file)) {
        subtitleFiles.push(file);
      } else {
        invalidFiles.push(file);
      }
    }

    return { videoFiles, subtitleFiles, invalidFiles };
  }

  /**
   * Get file extension including the dot
   */
  getFileExtension(filename) {
    const lastDot = filename.lastIndexOf('.');
    return lastDot === -1 ? '' : filename.substring(lastDot).toLowerCase();
  }

  /**
   * Get base filename without extension
   */
  getBaseName(filename) {
    const lastDot = filename.lastIndexOf('.');
    return lastDot === -1 ? filename : filename.substring(0, lastDot);
  }

  /**
   * Generate output filename (matches Python output naming)
   */
  generateOutputFilename(inputFilename, format) {
    const baseName = this.getBaseName(inputFilename);
    return `${baseName}_con.${format}`;
  }

  /**
   * Download file to user's computer
   */
  downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  /**
   * Format duration in milliseconds to readable format
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}
