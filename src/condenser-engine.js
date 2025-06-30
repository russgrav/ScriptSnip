import { SubtitleProcessor } from './subtitle-processor.js';
import { AudioProcessor } from './audio-processor.js';
import { FileManager } from './file-manager.js';

export class CondenserEngine {
  constructor(onProgress) {
    this.subtitleProcessor = new SubtitleProcessor();
    this.audioProcessor = new AudioProcessor((progressData) => this.handleAudioProgress(progressData));
    this.fileManager = new FileManager();
    this.isProcessing = false;
    this.shouldStop = false;
    this.onProgress = onProgress;
    this.currentProgress = {
      stage: '',
      progress: 0,
      total: 100,
      message: '',
      currentFile: '',
      fileIndex: 0,
      totalFiles: 0,
      percentComplete: 0,
      estimatedTimeRemaining: null,
      startTime: null,
      currentFileProgress: 0,
      stageStartTime: null,
      stageStartProgress: 0
    };
    this.processingTimes = [];
    this.progressTimer = null;
    this.progressHistory = []; // Track progress over time for better estimates
    
    // Define stage weights for smooth progress calculation
    this.stageWeights = {
      'Reading subtitles': { start: 0, weight: 2 },
      'Analyzing subtitles': { start: 2, weight: 3 },
      'Extracting audio': { start: 5, weight: 40 },
      'Processing segments': { start: 45, weight: 25 },
      'Concatenating': { start: 70, weight: 15 },
      'Exporting': { start: 85, weight: 12 },
      'Creating subtitles': { start: 97, weight: 2 },
      'Complete': { start: 99, weight: 1 }
    };
  }

  /**
   * Start smooth progress interpolation for a stage
   */
  startSmoothProgress(stage, message, estimatedDurationMs = 1000) {
    this.stopSmoothProgress();
    
    const stageInfo = this.stageWeights[stage];
    if (!stageInfo) return;
    
    this.currentProgress.stage = stage;
    this.currentProgress.message = message;
    this.currentProgress.stageStartTime = Date.now();
    this.currentProgress.stageStartProgress = this.currentProgress.currentFileProgress;
    
    const targetProgress = stageInfo.start + stageInfo.weight;
    const progressRange = targetProgress - this.currentProgress.stageStartProgress;
    
    // Update progress smoothly over time
    this.progressTimer = setInterval(() => {
      const elapsed = Date.now() - this.currentProgress.stageStartTime;
      const progressRatio = Math.min(elapsed / estimatedDurationMs, 1);
      
      // Use easing function for more natural progress
      const easedRatio = this.easeInOutCubic(progressRatio);
      
      const newProgress = this.currentProgress.stageStartProgress + (progressRange * easedRatio);
      this.updateProgressValue(Math.min(newProgress, targetProgress));
      
      if (progressRatio >= 1) {
        this.stopSmoothProgress();
      }
    }, 50); // Update every 50ms for smooth animation
  }
  
  /**
   * Stop smooth progress interpolation
   */
  stopSmoothProgress() {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }
  
  /**
   * Easing function for natural progress animation
   */
  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  
  /**
   * Update progress value and notify UI
   */
  updateProgressValue(currentFileProgress) {
    this.currentProgress.currentFileProgress = Math.min(Math.max(currentFileProgress, 0), 100);
    this.currentProgress.percentComplete = this.calculateOverallProgress(this.currentProgress.currentFileProgress);
    
    // Track progress history for better time estimates
    const now = Date.now();
    this.progressHistory.push({
      timestamp: now,
      progress: this.currentProgress.percentComplete
    });
    
    // Keep only last 10 seconds of history
    const cutoff = now - 10000;
    this.progressHistory = this.progressHistory.filter(entry => entry.timestamp > cutoff);
    
    this.currentProgress.estimatedTimeRemaining = this.calculateEstimatedTime();
    
    this.onProgress?.({ ...this.currentProgress });
  }

  /**
   * Handle progress updates from audio processor and add file context
   */
  handleAudioProgress(audioProgressData) {
    // Stop any smooth interpolation since we have real progress data
    this.stopSmoothProgress();
    
    // Calculate smooth progress for current file
    const currentFileProgress = this.calculateCurrentFileProgress(audioProgressData);
    
    this.currentProgress.stage = audioProgressData.stage;
    this.currentProgress.message = audioProgressData.message;
    this.updateProgressValue(currentFileProgress);
  }

  /**
   * Calculate smooth 0-100% progress for the current file
   */
  calculateCurrentFileProgress(audioProgressData) {
    const stage = audioProgressData.stage;
    const stageInfo = this.stageWeights[stage];
    
    if (!stageInfo) {
      return this.currentProgress.currentFileProgress || 0;
    }
    
    // Calculate progress within the current stage
    let stageProgress = 0;
    if (audioProgressData.total > 0) {
      stageProgress = (audioProgressData.progress / audioProgressData.total);
    }
    
    // Convert to overall file progress (0-100)
    const fileProgress = stageInfo.start + (stageProgress * stageInfo.weight);
    
    return Math.min(Math.max(fileProgress, 0), 100);
  }

  /**
   * Calculate overall progress across all files
   */
  calculateOverallProgress(currentFileProgress) {
    if (this.currentProgress.totalFiles === 0) return 0;
    
    // Calculate overall progress across all files
    const completedFiles = this.currentProgress.fileIndex - 1;
    const overallProgress = ((completedFiles + (currentFileProgress / 100)) / this.currentProgress.totalFiles) * 100;
    
    return Math.min(Math.max(overallProgress, 0), 100);
  }

  /**
   * Calculate estimated time remaining with improved accuracy
   */
  calculateEstimatedTime() {
    if (!this.currentProgress.startTime || this.currentProgress.totalFiles <= 1) {
      return null;
    }
    
    const now = Date.now();
    const elapsed = now - this.currentProgress.startTime;
    const currentProgress = this.currentProgress.percentComplete;
    
    // Don't show estimates until we have some meaningful progress
    if (currentProgress < 5 || elapsed < 3000) {
      return null;
    }
    
    let timeRemaining = null;
    
    // Use historical data if we have enough samples
    if (this.progressHistory.length >= 3) {
      // Calculate average speed over recent history
      const recentHistory = this.progressHistory.slice(-5); // Last 5 data points
      const oldestRecent = recentHistory[0];
      const newest = recentHistory[recentHistory.length - 1];
      
      const timeDiff = newest.timestamp - oldestRecent.timestamp;
      const progressDiff = newest.progress - oldestRecent.progress;
      
      if (timeDiff > 1000 && progressDiff > 0) { // At least 1 second and some progress
        const progressRate = progressDiff / timeDiff; // progress per millisecond
        const remainingProgress = 100 - currentProgress;
        timeRemaining = remainingProgress / progressRate;
      }
    }
    
    // Fallback to simple linear estimation (but only after more progress)
    if (!timeRemaining && currentProgress > 15) {
      const progressRate = currentProgress / elapsed;
      const remainingProgress = 100 - currentProgress;
      timeRemaining = remainingProgress / progressRate;
    }
    
    // Apply some smoothing and bounds
    if (timeRemaining) {
      // Don't show estimates that are clearly wrong
      if (timeRemaining > 30 * 60 * 1000) { // More than 30 minutes
        return null;
      }
      
      // Smooth the estimate to avoid wild fluctuations
      if (this.lastEstimate) {
        const change = Math.abs(timeRemaining - this.lastEstimate);
        const maxChange = this.lastEstimate * 0.3; // Max 30% change
        if (change > maxChange) {
          timeRemaining = this.lastEstimate + (timeRemaining > this.lastEstimate ? maxChange : -maxChange);
        }
      }
      
      this.lastEstimate = timeRemaining;
      return Math.max(timeRemaining, 1000); // At least 1 second
    }
    
    return null;
  }

  /**
   * Format time in a human-readable format
   */
  formatTime(milliseconds) {
    if (!milliseconds) return null;
    
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Main condensing function (port from Python condense function)
   */
  async condenseSingleFile(videoFile, subtitleFile, config, fileIndex = 1, totalFiles = 1) {
    const startTime = Date.now();
    
    // Reset progress tracking for new file
    this.progressHistory = [];
    this.lastEstimate = null;
    
    // Update progress context
    this.currentProgress.currentFile = videoFile.name;
    this.currentProgress.fileIndex = fileIndex;
    this.currentProgress.totalFiles = totalFiles;
    this.currentProgress.startTime = this.currentProgress.startTime || startTime;

    try {
      // 1. Get subtitle content
      let subtitleContent;
      if (subtitleFile) {
        this.startSmoothProgress('Reading subtitles', `Reading subtitles for ${videoFile.name}...`, 500);
        subtitleContent = await subtitleFile.text();
        this.stopSmoothProgress();
        this.setStageComplete('Reading subtitles', 'Subtitle content loaded');
      } else {
        throw new Error('No subtitle file provided. Embedded subtitle extraction not yet implemented.');
      }

      // 2. Extract periods from subtitles (Python: extract_periods)
      this.startSmoothProgress('Analyzing subtitles', 'Extracting speech periods from subtitles...', 800);
      const periods = this.subtitleProcessor.extractPeriods(subtitleContent, config);
      this.stopSmoothProgress();
      this.setStageComplete('Analyzing subtitles', `Found ${periods.length} speech periods`);
      
      if (periods.length === 0) {
        throw new Error('No valid subtitle periods found after filtering');
      }

      // 3. Extract audio from video (Python: FFmpeg audio extraction)
      // Audio processor will handle its own progress updates with real data
      const audioBuffer = await this.audioProcessor.extractAudio(videoFile);
      const originalDuration = this.audioProcessor.getAudioDuration(audioBuffer);

      // 4. Extract audio segments (Python: extract_audio_parts)
      // Audio processor will handle its own progress updates with real data
      const audioSegments = await this.audioProcessor.extractAudioSegments(periods, audioBuffer);
      
      // 5. Concatenate segments (Python: concatenate_audio_parts)
      // Audio processor will handle its own progress updates with real data
      const condensedAudioBuffer = await this.audioProcessor.concatenateAudioSegments(audioSegments);
      const condensedDuration = this.audioProcessor.getAudioDuration(condensedAudioBuffer);

      // 6. Export to desired format
      // Audio processor will handle its own progress updates with real data
      const audioBlob = await this.audioProcessor.exportAudio(condensedAudioBuffer, config.outputFormat);

      // 7. Create condensed subtitles if requested (Python: condense_subtitles)
      let subtitleBlob;
      if (config.outputCondensedSubtitles) {
        this.startSmoothProgress('Creating subtitles', 'Creating condensed subtitles...', 300);
        const condensedSubtitleContent = this.subtitleProcessor.createCondensedSubtitles(
          periods,
          subtitleContent,
          config.condensedSubtitlesFormat
        );
        subtitleBlob = new Blob([condensedSubtitleContent], { type: 'text/plain' });
        this.stopSmoothProgress();
        this.setStageComplete('Creating subtitles', 'Condensed subtitles created');
      }

      const processingTime = Date.now() - startTime;
      this.processingTimes.push(processingTime);
      
      this.setStageComplete('Complete', `Processing complete for ${videoFile.name}`);

      return {
        audioBlob,
        subtitleBlob,
        originalFilename: videoFile.name,
        processingTime,
        periodsCount: periods.length,
        originalDuration,
        condensedDuration
      };

    } catch (error) {
      this.stopSmoothProgress(); // Clean up on error
      throw new Error(`Processing failed: ${error.message}`);
    }
  }

  /**
   * Process multiple files with batching and memory management
   */
  async condenseMultipleFiles(files, config, options = {}) {
    const {
      batchSize = 3,           // Process 3 files at a time
      pauseBetweenBatches = 1000, // 1 second pause between batches
      maxConcurrent = 1        // Process 1 file at a time for memory safety
    } = options;

    const validation = this.fileManager.validateFiles(files);
    
    if (validation.videoFiles.length === 0) {
      throw new Error('No video files found in selection');
    }

    this.isProcessing = true;
    this.shouldStop = false;

    const results = [];
    const errors = [];
    
    // Find matching subtitles (Python logic)
    const { matches: subtitleMatches, invalidVideos } = this.fileManager.findMatchingSubtitles(
      validation.videoFiles,
      files,
      config
    );

    if (invalidVideos.length > 0) {
      console.warn(`Videos without matching subtitles: ${invalidVideos.map(f => f.name).join(', ')}`);
    }

    // Create processing queue with only valid video-subtitle pairs
    const processingQueue = [];
    for (let i = 0; i < validation.videoFiles.length; i++) {
      const videoFile = validation.videoFiles[i];
      const subtitleFile = subtitleMatches[i];
      
      if (subtitleFile) {
        processingQueue.push({ videoFile, subtitleFile, index: i + 1 });
      }
    }

    console.log(`Processing ${processingQueue.length} files in batches of ${batchSize}`);

    // Process in batches
    for (let batchStart = 0; batchStart < processingQueue.length; batchStart += batchSize) {
      if (this.shouldStop) {
        console.log('Processing stopped by user');
        break;
      }

      const batchEnd = Math.min(batchStart + batchSize, processingQueue.length);
      const currentBatch = processingQueue.slice(batchStart, batchEnd);
      const batchNumber = Math.floor(batchStart / batchSize) + 1;
      const totalBatches = Math.ceil(processingQueue.length / batchSize);

      console.log(`Processing batch ${batchNumber}/${totalBatches} (files ${batchStart + 1}-${batchEnd})`);

      // Process current batch (with limited concurrency)
      if (maxConcurrent === 1) {
        // Process files one by one for maximum memory safety
        for (const item of currentBatch) {
          if (this.shouldStop) break;

          try {
            console.log(`Processing file ${item.index}/${processingQueue.length}: ${item.videoFile.name}`);
            
            const result = await this.condenseSingleFile(
              item.videoFile, 
              item.subtitleFile, 
              config, 
              item.index, 
              processingQueue.length
            );
            results.push(result);
            
            // Force garbage collection hint
            if (window.gc) {
              window.gc();
            }
            
            // Small pause between files
            await this.sleep(500);
            
          } catch (error) {
            console.error(`Failed to process ${item.videoFile.name}:`, error);
            errors.push({ filename: item.videoFile.name, error: error.message });
          }
        }
      } else {
        // Process files concurrently within batch
        const batchPromises = currentBatch.map(async (item) => {
          if (this.shouldStop) return null;

          try {
            console.log(`Processing file ${item.index}/${processingQueue.length}: ${item.videoFile.name}`);
            const result = await this.condenseSingleFile(
              item.videoFile, 
              item.subtitleFile, 
              config, 
              item.index, 
              processingQueue.length
            );
            return result;
          } catch (error) {
            console.error(`Failed to process ${item.videoFile.name}:`, error);
            errors.push({ filename: item.videoFile.name, error: error.message });
            return null;
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.filter(result => result !== null));
      }

      // Memory cleanup between batches
      if (batchEnd < processingQueue.length) {
        console.log(`Batch ${batchNumber} complete. Pausing for ${pauseBetweenBatches}ms...`);
        await this.sleep(pauseBetweenBatches);
        
        // Request garbage collection if available
        if (window.gc) {
          window.gc();
        }
      }
    }

    this.isProcessing = false;

    if (errors.length > 0) {
      console.warn(`Processing completed with ${errors.length} errors:`, errors);
    }

    console.log(`Successfully processed ${results.length}/${processingQueue.length} files`);
    return results;
  }

  /**
   * Stop processing (for user control)
   */
  stop() {
    console.log('Stop requested...');
    this.shouldStop = true;
    this.stopSmoothProgress();
  }

  /**
   * Check if currently processing
   */
  isCurrentlyProcessing() {
    return this.isProcessing;
  }

  /**
   * Estimate memory usage for a batch
   */
  estimateMemoryUsage(files) {
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    // Rough estimate: video file size + extracted audio (10-20% of video) + processing overhead
    const estimatedMemoryMB = (totalSize * 1.5) / (1024 * 1024);
    return {
      totalFileSizeMB: totalSize / (1024 * 1024),
      estimatedMemoryMB,
      recommendation: estimatedMemoryMB > 2000 ? 'Consider processing fewer files at once' : 'Should be fine'
    };
  }

  /**
   * Download processing results with rate limiting
   */
  async downloadResults(results, config) {
    console.log(`Downloading ${results.length} result files...`);
    
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      
      // Download audio file
      const audioFilename = this.fileManager.generateOutputFilename(
        result.originalFilename,
        config.outputFormat
      );
      this.fileManager.downloadFile(result.audioBlob, audioFilename);

      // Download subtitle file if available
      if (result.subtitleBlob) {
        const subtitleFilename = this.fileManager.generateOutputFilename(
          result.originalFilename,
          config.condensedSubtitlesFormat
        );
        this.fileManager.downloadFile(result.subtitleBlob, subtitleFilename);
      }

      // Small delay between downloads to avoid browser limits
      if (i < results.length - 1) {
        await this.sleep(200);
      }
    }
  }

  /**
   * Set a stage as complete and move to its end position
   */
  setStageComplete(stage, message) {
    const stageInfo = this.stageWeights[stage];
    if (stageInfo) {
      const targetProgress = stageInfo.start + stageInfo.weight;
      this.currentProgress.stage = stage;
      this.currentProgress.message = message;
      this.updateProgressValue(targetProgress);
    }
  }

  /**
   * Update progress with smooth transitions (for stages managed by CondenserEngine)
   */
  updateSmoothProgress(stage, progress, total, message) {
    // Legacy method - convert to new smooth progress system
    const progressData = {
      stage,
      progress,
      total,
      message
    };
    
    this.handleAudioProgress(progressData);
  }

  /**
   * Update progress with additional context (legacy method for compatibility)
   */
  updateProgress(stage, progress, total, message) {
    this.updateSmoothProgress(stage, progress, total, message);
  }

  /**
   * Utility function for delays
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.shouldStop = true;
    this.stopSmoothProgress();
    await this.audioProcessor.cleanup();
  }
}
