import { FFmpeg } from '@ffmpeg/ffmpeg';

export class AudioProcessor {
  constructor(onProgress) {
    this.ffmpeg = new FFmpeg();
    this.isLoaded = false;
    this.onProgress = onProgress;
    this.setupFFmpegLogging();
  }

  setupFFmpegLogging() {
    this.ffmpeg.on('log', ({ message }) => {
      console.log('FFmpeg:', message);
    });
  }

  /**
   * Initialize FFmpeg.wasm with simplified loading
   */
  async initialize() {
    if (this.isLoaded) return;

    this.onProgress?.({
      stage: 'loading',
      progress: 0,
      total: 100,
      message: 'Loading FFmpeg...'
    });

    try {
      console.log('Initializing FFmpeg...');
      
      // Use a simpler loading approach
      await this.ffmpeg.load({
        coreURL: "https://unpkg.com/@ffmpeg/core@0.12.4/dist/esm/ffmpeg-core.js",
        wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.4/dist/esm/ffmpeg-core.wasm",
      });

      this.isLoaded = true;
      console.log('FFmpeg loaded successfully');
      
      this.onProgress?.({
        stage: 'loading',
        progress: 100,
        total: 100,
        message: 'FFmpeg loaded successfully'
      });

    } catch (error) {
      console.error('FFmpeg loading failed:', error);
      
      // Try alternative approach with manual file loading
      try {
        console.log('Trying alternative FFmpeg loading method...');
        
        const coreURL = "https://unpkg.com/@ffmpeg/core-mt@0.12.4/dist/esm/ffmpeg-core.js";
        const wasmURL = "https://unpkg.com/@ffmpeg/core-mt@0.12.4/dist/esm/ffmpeg-core.wasm";
        
        await this.ffmpeg.load({
          coreURL,
          wasmURL,
          workerURL: "https://unpkg.com/@ffmpeg/core-mt@0.12.4/dist/esm/ffmpeg-core.worker.js"
        });

        this.isLoaded = true;
        console.log('FFmpeg loaded with alternative method');
        
        this.onProgress?.({
          stage: 'loading',
          progress: 100,
          total: 100,
          message: 'FFmpeg loaded successfully'
        });
        
      } catch (altError) {
        console.error('Alternative FFmpeg loading also failed:', altError);
        throw new Error(`Failed to load FFmpeg. This may be due to browser compatibility issues. Please try using Chrome or Firefox with the latest version. Original error: ${error.message}`);
      }
    }
  }

  /**
   * Extract audio from video file (simplified approach)
   */
  async extractAudio(videoFile) {
    if (!this.isLoaded) {
      await this.initialize();
    }

    this.onProgress?.({
      stage: 'extracting',
      progress: 0,
      total: 100,
      message: 'Extracting audio from video...'
    });

    try {
      console.log(`Processing video file: ${videoFile.name} (${(videoFile.size / 1024 / 1024).toFixed(1)} MB)`);
      
      // Write input file
      const inputData = new Uint8Array(await videoFile.arrayBuffer());
      await this.ffmpeg.writeFile('input.mkv', inputData);

      this.onProgress?.({
        stage: 'extracting',
        progress: 25,
        total: 100,
        message: 'Processing with FFmpeg...'
      });

      console.log('Starting FFmpeg audio extraction...');

      // Extract audio with simpler parameters for better compatibility
      await this.ffmpeg.exec([
        '-i', 'input.mkv',
        '-vn',                    // no video
        '-acodec', 'pcm_s16le',   // uncompressed audio
        '-ar', '44100',           // sample rate
        '-ac', '2',               // stereo
        'output.wav'
      ]);

      console.log('FFmpeg extraction completed');

      this.onProgress?.({
        stage: 'extracting',
        progress: 75,
        total: 100,
        message: 'Reading extracted audio...'
      });

      // Read the output
      const audioData = await this.ffmpeg.readFile('output.wav');
      console.log(`Extracted audio data: ${audioData.length} bytes`);
      
      const audioBuffer = await this.decodeAudioData(audioData);
      console.log(`Decoded audio buffer: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.sampleRate}Hz`);

      this.onProgress?.({
        stage: 'extracting',
        progress: 100,
        total: 100,
        message: 'Audio extraction complete'
      });

      return audioBuffer;
    } catch (error) {
      console.error('Audio extraction failed:', error);
      throw new Error(`Failed to extract audio from ${videoFile.name}: ${error.message}`);
    }
  }

  /**
   * Extract audio segments based on periods
   */
  async extractAudioSegments(periods, audioBuffer) {
    this.onProgress?.({
      stage: 'segmenting',
      progress: 0,
      total: periods.length,
      message: 'Extracting audio segments...'
    });

    const segments = [];
    console.log(`Extracting ${periods.length} audio segments from ${audioBuffer.duration.toFixed(2)}s audio`);

    for (let i = 0; i < periods.length; i++) {
      const period = periods[i];
      
      // Convert milliseconds to samples
      const startSample = Math.floor(period.start * audioBuffer.sampleRate / 1000);
      const endSample = Math.floor(period.end * audioBuffer.sampleRate / 1000);
      const segmentLength = Math.max(0, Math.min(endSample - startSample, audioBuffer.length - startSample));

      if (segmentLength <= 0) {
        console.warn(`Skipping invalid segment ${i + 1}: start=${period.start}ms, end=${period.end}ms`);
        continue;
      }

      // Create new audio buffer for this segment
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const segment = audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        segmentLength,
        audioBuffer.sampleRate
      );

      // Copy audio data for each channel
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const sourceData = audioBuffer.getChannelData(channel);
        const segmentData = segment.getChannelData(channel);

        for (let j = 0; j < segmentLength; j++) {
          const sourceIndex = startSample + j;
          segmentData[j] = sourceIndex < sourceData.length ? sourceData[sourceIndex] : 0;
        }
      }

      segments.push(segment);

      // Progress update
      this.onProgress?.({
        stage: 'segmenting',
        progress: i + 1,
        total: periods.length,
        message: `Extracted segment ${i + 1}/${periods.length} (${(period.end - period.start)}ms)`
      });

      // Log progress every 10 segments
      if ((i + 1) % 10 === 0 || i === periods.length - 1) {
        console.log(`Extracted ${i + 1}/${periods.length} segments`);
      }
    }

    console.log(`Successfully extracted ${segments.length} audio segments`);
    return segments;
  }

  /**
   * Concatenate audio segments
   */
  async concatenateAudioSegments(segments) {
    if (segments.length === 0) {
      throw new Error('No audio segments to concatenate');
    }

    this.onProgress?.({
      stage: 'concatenating',
      progress: 0,
      total: 100,
      message: 'Concatenating audio segments...'
    });

    // Calculate total length
    const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
    console.log(`Concatenating ${segments.length} segments into ${(totalLength / segments[0].sampleRate).toFixed(2)}s audio`);
    
    // Create output buffer
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const outputBuffer = audioContext.createBuffer(
      segments[0].numberOfChannels,
      totalLength,
      segments[0].sampleRate
    );

    // Concatenate all segments
    let currentOffset = 0;
    for (let segIndex = 0; segIndex < segments.length; segIndex++) {
      const segment = segments[segIndex];
      
      for (let channel = 0; channel < segment.numberOfChannels; channel++) {
        const sourceData = segment.getChannelData(channel);
        const outputData = outputBuffer.getChannelData(channel);
        
        for (let i = 0; i < segment.length; i++) {
          outputData[currentOffset + i] = sourceData[i];
        }
      }
      
      currentOffset += segment.length;

      // Progress update
      const progress = Math.round((segIndex + 1) / segments.length * 100);
      this.onProgress?.({
        stage: 'concatenating',
        progress,
        total: 100,
        message: `Concatenating segment ${segIndex + 1}/${segments.length}`
      });
    }

    console.log('Audio concatenation completed');
    return outputBuffer;
  }

  /**
   * Export audio buffer to specified format
   */
  async exportAudio(audioBuffer, format) {
    if (!this.isLoaded) {
      await this.initialize();
    }

    this.onProgress?.({
      stage: 'exporting',
      progress: 0,
      total: 100,
      message: `Exporting to ${format.toUpperCase()}...`
    });

    try {
      console.log(`Exporting ${audioBuffer.duration.toFixed(2)}s audio to ${format}`);
      
      // Convert AudioBuffer to WAV first
      const wavBlob = this.audioBufferToWav(audioBuffer);
      const wavData = new Uint8Array(await wavBlob.arrayBuffer());
      
      await this.ffmpeg.writeFile('temp.wav', wavData);

      this.onProgress?.({
        stage: 'exporting',
        progress: 50,
        total: 100,
        message: `Converting to ${format.toUpperCase()}...`
      });

      // Convert to desired format
      const outputFile = `output.${format}`;
      const codecMap = {
        'mp3': ['-acodec', 'libmp3lame', '-b:a', '192k'],
        'wav': ['-acodec', 'pcm_s16le'],
        'flac': ['-acodec', 'flac'],
        'aac': ['-acodec', 'aac', '-b:a', '192k']
      };

      const codecArgs = codecMap[format] || codecMap['mp3'];

      await this.ffmpeg.exec([
        '-i', 'temp.wav',
        ...codecArgs,
        outputFile
      ]);

      const outputData = await this.ffmpeg.readFile(outputFile);
      console.log(`Export completed: ${outputData.length} bytes`);
      
      this.onProgress?.({
        stage: 'exporting',
        progress: 100,
        total: 100,
        message: `Export to ${format.toUpperCase()} complete`
      });

      return new Blob([outputData], { type: `audio/${format}` });
    } catch (error) {
      console.error('Audio export failed:', error);
      throw new Error(`Failed to export audio: ${error.message}`);
    }
  }

  /**
   * Decode audio data to AudioBuffer
   */
  async decodeAudioData(audioData) {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = audioData instanceof Uint8Array ? audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength) : audioData;
      return await audioContext.decodeAudioData(buffer);
    } catch (error) {
      console.error('Audio decoding failed:', error);
      throw new Error(`Failed to decode audio data: ${error.message}`);
    }
  }

  /**
   * Convert AudioBuffer to WAV blob
   */
  audioBufferToWav(audioBuffer) {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numberOfChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = audioBuffer.length * blockAlign;
    const bufferSize = 44 + dataSize;

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // Write WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Write audio data
    let offset = 44;
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i]));
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  /**
   * Get audio duration from buffer
   */
  getAudioDuration(audioBuffer) {
    return audioBuffer.length / audioBuffer.sampleRate * 1000; // milliseconds
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.isLoaded) {
      try {
        await this.ffmpeg.terminate();
      } catch (error) {
        console.warn('Error during FFmpeg cleanup:', error);
      }
      this.isLoaded = false;
    }
  }
}
