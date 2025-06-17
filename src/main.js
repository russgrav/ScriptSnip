import { CondenserEngine } from './condenser-engine.js';
import { FileManager } from './file-manager.js';
import { defaultConfig } from './types.js';

class AudioCondenserApp {
  constructor() {
    this.config = { ...defaultConfig };
    this.fileManager = new FileManager();
    this.condenserEngine = new CondenserEngine(this.onProgress.bind(this));
    this.selectedFiles = [];
    this.isProcessing = false;
    
    this.initializeUI();
    this.loadConfigFromUI();
    this.checkBrowserCompatibility();
  }

  checkBrowserCompatibility() {
    const issues = [];
    
    if (!window.AudioContext && !window.webkitAudioContext) {
      issues.push('Web Audio API not supported');
    }
    
    if (!window.SharedArrayBuffer) {
      console.warn('SharedArrayBuffer not available - FFmpeg performance may be reduced');
    }
    
    if (!window.WebAssembly) {
      issues.push('WebAssembly not supported');
    }

    // Check available memory (if supported)
    if (navigator.deviceMemory) {
      const memoryGB = navigator.deviceMemory;
      console.log(`Device memory: ${memoryGB}GB`);
      if (memoryGB < 4) {
        console.warn('Low device memory detected. Consider processing fewer files at once.');
      }
    }

    if (issues.length > 0) {
      this.showError(`Browser compatibility issues: ${issues.join(', ')}. Please use a modern browser like Chrome, Firefox, or Safari.`);
    }
  }

  initializeUI() {
    // Tab switching
    const tabs = document.querySelectorAll('.tab');
    const panels = document.querySelectorAll('.tab-panel');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetPanel = tab.getAttribute('data-tab');
        
        // Update active tab
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Update active panel
        panels.forEach(p => p.classList.remove('active'));
        document.getElementById(`${targetPanel}-panel`)?.classList.add('active');
      });
    });

    // File input handling
    this.setupFileInput();
    
    // Config change handlers
    this.setupConfigHandlers();
    
    // Process button
    const processButton = document.getElementById('process-button');
    processButton.addEventListener('click', this.startProcessing.bind(this));

    // Add stop button (we'll add this to the HTML later)
    const stopButton = document.getElementById('stop-button');
    if (stopButton) {
      stopButton.addEventListener('click', this.stopProcessing.bind(this));
    }
  }

  setupFileInput() {
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('file-drop-zone');

    // File input change
    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      this.handleFiles(files);
    });

    // Drag and drop
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      
      const files = Array.from(e.dataTransfer?.files || []);
      this.handleFiles(files);
    });
  }

  setupConfigHandlers() {
    // Listen for changes to all config inputs
    const configInputs = [
      'padding', 'output-format', 'filter-parentheses', 'filtered-characters',
      'sub-suffix', 'output-condensed-subtitles', 'condensed-subtitles-format'
    ];

    configInputs.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener('change', this.loadConfigFromUI.bind(this));
      }
    });
  }

  loadConfigFromUI() {
    this.config = {
      padding: parseInt(document.getElementById('padding').value) || 500,
      askWhenMultipleSrt: true, // Not implemented in UI yet
      filteredCharacters: document.getElementById('filtered-characters').value,
      filterParentheses: document.getElementById('filter-parentheses').checked,
      outputFormat: document.getElementById('output-format').value,
      subSuffix: document.getElementById('sub-suffix').value,
      fixedOutputDir: null, // Not implemented in UI
      fixedOutputDirWithSubfolders: true, // Not implemented in UI
      outputCondensedSubtitles: document.getElementById('output-condensed-subtitles').checked,
      condensedSubtitlesFormat: document.getElementById('condensed-subtitles-format').value
    };
  }

  handleFiles(files) {
    this.selectedFiles = files;
    this.displayFiles();
    this.updateProcessButton();
    this.hideError();
    this.showMemoryEstimate();
  }

  showMemoryEstimate() {
    const validation = this.fileManager.validateFiles(this.selectedFiles);
    if (validation.videoFiles.length > 0) {
      const estimate = this.condenserEngine.estimateMemoryUsage(validation.videoFiles);
      
      let message = `Selected ${validation.videoFiles.length} video files (${estimate.totalFileSizeMB.toFixed(1)} MB total)`;
      
      if (validation.videoFiles.length > 10) {
        message += `. Large batch detected - files will be processed in smaller groups for stability.`;
      }
      
      if (estimate.estimatedMemoryMB > 2000) {
        message += ` ⚠️ High memory usage expected (${estimate.estimatedMemoryMB.toFixed(0)} MB). Consider processing fewer files at once.`;
      }

      console.log('Memory estimate:', estimate);
      
      // Show this info in the UI
      const fileList = document.getElementById('file-list');
      const existingWarning = fileList.querySelector('.memory-warning');
      if (existingWarning) {
        existingWarning.remove();
      }

      if (validation.videoFiles.length > 5 || estimate.estimatedMemoryMB > 1000) {
        const warningDiv = document.createElement('div');
        warningDiv.className = 'memory-warning';
        warningDiv.style.cssText = 'background: #fff3cd; padding: 10px; border-radius: 6px; margin: 10px 0; border-left: 4px solid #ffc107; font-size: 14px;';
        warningDiv.innerHTML = `<strong>Large Batch Processing:</strong> ${message}`;
        fileList.appendChild(warningDiv);
      }
    }
  }

  displayFiles() {
    const fileList = document.getElementById('file-list');
    const validation = this.fileManager.validateFiles(this.selectedFiles);

    if (this.selectedFiles.length === 0) {
      fileList.innerHTML = '';
      return;
    }

    const html = this.selectedFiles.map(file => {
      let statusClass = 'status-invalid';
      let statusText = 'Unsupported';

      if (this.fileManager.isVideoFile(file)) {
        statusClass = 'status-video';
        statusText = 'Video';
      } else if (this.fileManager.isSubtitleFile(file)) {
        statusClass = 'status-subtitle';
        statusText = 'Subtitle';
      }

      return `
        <div class="file-item">
          <div class="file-info">
            <div class="file-name">${file.name}</div>
            <div class="file-size">${this.fileManager.formatFileSize(file.size)}</div>
          </div>
          <div class="file-status ${statusClass}">${statusText}</div>
        </div>
      `;
    }).join('');

    fileList.innerHTML = html;

    // Show validation summary
    if (validation.invalidFiles.length > 0) {
      this.showError(`${validation.invalidFiles.length} unsupported file(s) will be ignored.`);
    }
  }

  updateProcessButton() {
    const processButton = document.getElementById('process-button');
    const validation = this.fileManager.validateFiles(this.selectedFiles);

    if (this.isProcessing) {
      processButton.disabled = true;
      processButton.textContent = 'Processing...';
      processButton.style.background = '#dc3545';
    } else if (validation.videoFiles.length === 0) {
      processButton.disabled = true;
      processButton.textContent = 'Select video files to start processing';
      processButton.style.background = '#ccc';
    } else {
      processButton.disabled = false;
      const fileCount = validation.videoFiles.length;
      const batchInfo = fileCount > 10 ? ` (${Math.ceil(fileCount / 3)} batches)` : '';
      processButton.textContent = `Process ${fileCount} video file(s)${batchInfo}`;
      processButton.style.background = '#28a745';
    }
  }

  async startProcessing() {
    if (this.isProcessing) {
      // If already processing, act as stop button
      this.stopProcessing();
      return;
    }

    const validation = this.fileManager.validateFiles(this.selectedFiles);
    
    if (validation.videoFiles.length === 0) {
      this.showError('No video files selected for processing.');
      return;
    }

    this.isProcessing = true;
    this.updateProcessButton();
    this.showProgress();
    this.hideError();
    this.hideResults();

    // Update button to show stop functionality
    const processButton = document.getElementById('process-button');
    processButton.textContent = 'Stop Processing';
    processButton.style.background = '#dc3545';

    console.log('Starting processing with config:', this.config);
    console.log('Selected files:', this.selectedFiles.map(f => f.name));

    try {
      let results;

      if (validation.videoFiles.length === 1) {
        // Single file processing
        const videoFile = validation.videoFiles[0];
        console.log('Processing single video file:', videoFile.name);
        
        const subtitleFile = this.fileManager.findSubtitleWithSameName(
          videoFile, 
          this.selectedFiles, 
          this.config
        );

        if (!subtitleFile) {
          throw new Error(`No matching subtitle file found for ${videoFile.name}. Please ensure the subtitle file has the same name as the video file.`);
        }

        console.log('Found matching subtitle file:', subtitleFile.name);

        const result = await this.condenserEngine.condenseSingleFile(
          videoFile,
          subtitleFile,
          this.config
        );
        results = [result];
      } else {
        // Multiple file processing with smart batching
        console.log(`Processing ${validation.videoFiles.length} files with smart batching`);
        
        // Determine batch settings based on file count and size
        const batchOptions = this.calculateBatchOptions(validation.videoFiles);
        console.log('Batch options:', batchOptions);
        
        results = await this.condenserEngine.condenseMultipleFiles(
          this.selectedFiles,
          this.config,
          batchOptions
        );
      }

      if (results.length > 0) {
        console.log('Processing completed successfully:', results);
        this.showResults(results);
        this.condenserEngine.downloadResults(results, this.config);
      } else {
        this.showError('No files were successfully processed.');
      }

    } catch (error) {
      console.error('Processing failed:', error);
      
      // Provide more helpful error messages
      let errorMessage = error.message;
      if (errorMessage.includes('Failed to load FFmpeg')) {
        errorMessage = 'Failed to load FFmpeg. Please check your internet connection and try again. If the problem persists, try refreshing the page.';
      } else if (errorMessage.includes('No subtitle')) {
        errorMessage = 'No matching subtitle file found. Make sure your subtitle file has the same name as your video file (e.g., video.mp4 + video.srt).';
      } else if (errorMessage.includes('Failed to parse subtitles')) {
        errorMessage = 'Failed to parse subtitle file. Please ensure it\'s a valid SRT, VTT, or ASS file.';
      }
      
      this.showError(`Processing failed: ${errorMessage}`);
    } finally {
      this.isProcessing = false;
      this.updateProcessButton();
      this.hideProgress();
    }
  }

  stopProcessing() {
    console.log('Stopping processing...');
    this.condenserEngine.stop();
    this.isProcessing = false;
    this.updateProcessButton();
    this.hideProgress();
    this.showError('Processing stopped by user.');
  }

  calculateBatchOptions(videoFiles) {
    const fileCount = videoFiles.length;
    const totalSizeMB = videoFiles.reduce((sum, file) => sum + file.size, 0) / (1024 * 1024);
    const avgFileSizeMB = totalSizeMB / fileCount;

    // Adjust batch size based on file size and count
    let batchSize = 3; // Default
    let pauseBetweenBatches = 1000; // Default

    if (avgFileSizeMB > 500) { // Large files (>500MB each)
      batchSize = 1;
      pauseBetweenBatches = 2000;
    } else if (avgFileSizeMB > 200) { // Medium files (200-500MB each)
      batchSize = 2;
      pauseBetweenBatches = 1500;
    } else if (fileCount > 30) { // Many small files
      batchSize = 5;
      pauseBetweenBatches = 500;
    }

    return {
      batchSize,
      pauseBetweenBatches,
      maxConcurrent: 1 // Always process one at a time for memory safety
    };
  }

  onProgress(state) {
    const progressSection = document.getElementById('progress-section');
    const progressText = document.getElementById('progress-text');
    const progressFill = document.getElementById('progress-fill');

    progressText.textContent = state.message || `${state.stage}: ${state.progress}/${state.total}`;
    
    const percentage = state.total > 0 ? (state.progress / state.total) * 100 : 0;
    progressFill.style.width = `${percentage}%`;

    console.log('Progress update:', state);
  }

  showProgress() {
    const progressSection = document.getElementById('progress-section');
    progressSection.classList.add('active');
  }

  hideProgress() {
    const progressSection = document.getElementById('progress-section');
    progressSection.classList.remove('active');
  }

  showResults(results) {
    const resultsSection = document.getElementById('results-section');
    const resultsList = document.getElementById('results-list');

    const html = results.map(result => {
      const compressionRatio = ((result.originalDuration - result.condensedDuration) / result.originalDuration * 100).toFixed(1);
      
      return `
        <div class="result-item">
          <div class="result-info">
            <h4>${this.fileManager.generateOutputFilename(result.originalFilename, this.config.outputFormat)}</h4>
            <div class="result-stats">
              Original: ${this.fileManager.formatDuration(result.originalDuration)} → 
              Condensed: ${this.fileManager.formatDuration(result.condensedDuration)} 
              (${compressionRatio}% shorter, ${result.periodsCount} segments)
            </div>
          </div>
          <button class="download-button" onclick="window.audioApp.downloadResult('${result.originalFilename}')">
            Re-download
          </button>
        </div>
      `;
    }).join('');

    resultsList.innerHTML = html;
    resultsSection.classList.add('active');
  }

  hideResults() {
    const resultsSection = document.getElementById('results-section');
    resultsSection.classList.remove('active');
  }

  showError(message) {
    const errorElement = document.getElementById('error-message');
    errorElement.textContent = message;
    errorElement.classList.add('active');
    console.error('App error:', message);
  }

  hideError() {
    const errorElement = document.getElementById('error-message');
    errorElement.classList.remove('active');
  }

  // Public method for download button onclick
  downloadResult(originalFilename) {
    console.log(`Re-download requested for ${originalFilename}`);
    this.showError('Re-download feature not yet implemented. Files were automatically downloaded when processing completed.');
  }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
  // Make app globally accessible for button onclick handlers
  window.audioApp = new AudioCondenserApp();
});
