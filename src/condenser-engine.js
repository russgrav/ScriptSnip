import { SubtitleProcessor } from './subtitle-processor.js';
import { AudioProcessor } from './audio-processor.js';
import { FileManager } from './file-manager.js';

export class CondenserEngine {
  constructor(onProgress) {
    this.subtitleProcessor = new SubtitleProcessor();
    this.audioProcessor = new AudioProcessor(onProgress);
    this.fileManager = new FileManager();
    this.isProcessing = false;
    this.shouldStop = false;
  }

  /**
   * Main condensing function (port from Python condense function)
   */
  async condenseSingleFile(videoFile, subtitleFile, config) {
    const startTime = Date.now();

    try {
      // 1. Get subtitle content
      let subtitleContent;
      if (subtitleFile) {
        subtitleContent = await subtitleFile.text();
      } else {
        throw new Error('No subtitle file provided. Embedded subtitle extraction not yet implemented.');
      }

      // 2. Extract periods from subtitles (Python: extract_periods)
      const periods = this.subtitleProcessor.extractPeriods(subtitleContent, config);
      
      if (periods.length === 0) {
        throw new Error('No valid subtitle periods found after filtering');
      }

      // 3. Extract audio from video (Python: FFmpeg audio extraction)
      const audioBuffer = await this.audioProcessor.extractAudio(videoFile);
      const originalDuration = this.audioProcessor.getAudioDuration(audioBuffer);

      // 4. Extract audio segments (Python: extract_audio_parts)
      const audioSegments = await this.audioProcessor.extractAudioSegments(periods, audioBuffer);

      // 5. Concatenate segments (Python: concatenate_audio_parts)
      const condensedAudioBuffer = await this.audioProcessor.concatenateAudioSegments(audioSegments);
      const condensedDuration = this.audioProcessor.getAudioDuration(condensedAudioBuffer);

      // 6. Export to desired format
      const audioBlob = await this.audioProcessor.exportAudio(condensedAudioBuffer, config.outputFormat);

      // 7. Create condensed subtitles if requested (Python: condense_subtitles)
      let subtitleBlob;
      if (config.outputCondensedSubtitles) {
        const condensedSubtitleContent = this.subtitleProcessor.createCondensedSubtitles(
          periods,
          subtitleContent,
          config.condensedSubtitlesFormat
        );
        subtitleBlob = new Blob([condensedSubtitleContent], { type: 'text/plain' });
      }

      const processingTime = Date.now() - startTime;

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
            
            const result = await this.condenseSingleFile(item.videoFile, item.subtitleFile, config);
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
            const result = await this.condenseSingleFile(item.videoFile, item.subtitleFile, config);
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
    await this.audioProcessor.cleanup();
  }
}
