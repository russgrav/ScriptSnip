import { IntelligentFileMatcher } from './intelligent-file-matcher.js';

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
    
    // Initialize the intelligent file matcher
    this.intelligentMatcher = new IntelligentFileMatcher();
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
   * Find subtitle file with same name as video (enhanced with cross-format matching)
   * Now uses IntelligentFileMatcher for better episode matching
   */
  findSubtitleWithSameName(videoFile, allFiles, config) {
    const baseName = this.getBaseName(videoFile.name);
    
    // First, try exact name matching with sub_suffix (original Python logic)
    for (const ext of this.subtitleExtensions) {
      const subtitleName = baseName + config.subSuffix + ext;
      const matchingFile = allFiles.find(f => f.name === subtitleName);
      if (matchingFile) {
        console.log(`Found exact match: ${videoFile.name} -> ${matchingFile.name}`);
        return matchingFile;
      }
    }
    
    // If exact matching fails, use intelligent cross-format matching
    const subtitleFiles = allFiles.filter(f => this.isSubtitleFile(f));
    if (subtitleFiles.length > 0) {
      const enhancedConfig = {
        ...config,
        allVideoFiles: allFiles.filter(f => this.isVideoFile(f))
      };
      
      const match = this.intelligentMatcher.findBestSubtitleMatch(
        videoFile, 
        subtitleFiles, 
        enhancedConfig
      );
      
      if (match) {
        const videoInfo = this.intelligentMatcher.analyzeFilename(videoFile.name);
        const subtitleInfo = this.intelligentMatcher.analyzeFilename(match.name);
        
        console.log(`Found intelligent match: ${videoFile.name} (episode ${videoInfo.episode}) -> ${match.name} (S${subtitleInfo.season}E${subtitleInfo.episode})`);
        return match;
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
    const matchingDetails = [];

    for (const videoFile of videoFiles) {
      const subtitle = this.findSubtitleWithSameName(videoFile, allFiles, config);
      matches.push(subtitle);
      
      // Track matching details for reporting
      if (subtitle) {
        const exactMatch = this.findExactMatch(videoFile, allFiles, config);
        matchingDetails.push({
          video: videoFile.name,
          subtitle: subtitle.name,
          matchType: exactMatch ? 'exact' : 'intelligent'
        });
      } else {
        invalidVideos.push(videoFile);
        matchingDetails.push({
          video: videoFile.name,
          subtitle: null,
          matchType: 'none'
        });
      }
    }

    return { matches, invalidVideos, matchingDetails };
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

  /**
   * Find exact match only (without intelligent matching)
   * Used for comparison and debugging
   */
  findExactMatch(videoFile, allFiles, config) {
    const baseName = this.getBaseName(videoFile.name);
    
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
   * Get matching statistics for a set of files (enhanced with cross-format detection)
   */
  getMatchingStats(videoFiles, allFiles, config) {
    const stats = {
      total: videoFiles.length,
      exactMatches: 0,
      intelligentMatches: 0,
      noMatches: 0,
      matchedFiles: [],
      unmatchedFiles: [],
      crossFormatDetected: false
    };

    // Check if cross-format matching is being used
    const subtitleFiles = allFiles.filter(f => this.isSubtitleFile(f));
    const seasonMapping = this.intelligentMatcher.buildSeasonEpisodeMapping(videoFiles, subtitleFiles);
    stats.crossFormatDetected = seasonMapping !== null;

    for (const videoFile of videoFiles) {
      const exactMatch = this.findExactMatch(videoFile, allFiles, config);
      const anyMatch = this.findSubtitleWithSameName(videoFile, allFiles, config);

      if (exactMatch) {
        stats.exactMatches++;
        stats.matchedFiles.push({ video: videoFile.name, subtitle: exactMatch.name, type: 'exact' });
      } else if (anyMatch) {
        stats.intelligentMatches++;
        const matchType = stats.crossFormatDetected ? 'cross-format' : 'intelligent';
        stats.matchedFiles.push({ video: videoFile.name, subtitle: anyMatch.name, type: matchType });
      } else {
        stats.noMatches++;
        stats.unmatchedFiles.push(videoFile.name);
      }
    }

    return stats;
  }
}
