import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Moon,
  Sun,
  Upload,
  Settings,
  Info,
  Play,
  Square,
  Download,
  Film,
  FileText,
  AlertCircle,
  CheckCircle,
  Scissors,
} from "lucide-react";

// Import your existing engine modules
import { CondenserEngine } from "./condenser-engine.js";
import { FileManager } from "./file-manager.js";
import { defaultConfig } from "./types.js";

// Import testing utilities (for development) - temporarily disabled
// import { runMatchingTests, testWithYourFiles } from './matcher-tests.js';

function App() {
  // Theme state
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("theme");
    return saved || "light";
  });

  // App state
  const [activeTab, setActiveTab] = useState("process");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [config, setConfig] = useState({ ...defaultConfig });
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({
    stage: "",
    progress: 0,
    total: 0,
    message: "",
  });
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [showProgress, setShowProgress] = useState(false);

  // Refs for engine instances
  const fileManagerRef = useRef(new FileManager());
  const condenserEngineRef = useRef(null);

  // Initialize condenser engine
  useEffect(() => {
    condenserEngineRef.current = new CondenserEngine((progressState) => {
      setProgress(progressState);
    });

    // Add test functions to window for console debugging (only in development)
    // Temporarily disabled
    /*
    if (process.env.NODE_ENV === 'development') {
      window.testIntelligentMatcher = runMatchingTests;
      window.testWithYourFiles = testWithYourFiles;
      window.fileManager = fileManagerRef.current;
    }
    */
  }, []);

  // Theme effect
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  const handleFiles = useCallback(
    (files) => {
      setSelectedFiles(files);
      setError("");

      // Show memory estimate for large batches
      const validation = fileManagerRef.current.validateFiles(files);
      if (validation.videoFiles.length > 0 && condenserEngineRef.current) {
        const estimate = condenserEngineRef.current.estimateMemoryUsage(
          validation.videoFiles
        );

        if (
          validation.videoFiles.length > 5 ||
          estimate.estimatedMemoryMB > 1000
        ) {
          console.log(
            `Large batch detected: ${
              validation.videoFiles.length
            } files, ~${estimate.estimatedMemoryMB.toFixed(
              0
            )}MB estimated memory usage`
          );
        }

        // Get matching statistics
        const matchingStats = fileManagerRef.current.getMatchingStats(
          validation.videoFiles,
          files,
          config
        );
        console.log("File matching stats:", matchingStats);

        // Show intelligent matching info if any files use it
        if (matchingStats.intelligentMatches > 0) {
          console.log(
            `Intelligent matching found ${matchingStats.intelligentMatches} matches that wouldn't have been found with exact matching`
          );
        }
      }
    },
    [config]
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files || []);
      handleFiles(files);
    },
    [handleFiles]
  );

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleFileInput = useCallback(
    (e) => {
      const files = Array.from(e.target.files || []);
      handleFiles(files);
    },
    [handleFiles]
  );

  const startProcessing = async () => {
    if (isProcessing) {
      // Stop processing
      condenserEngineRef.current?.stop();
      setIsProcessing(false);
      setShowProgress(false);
      setError("Processing stopped by user.");
      return;
    }

    const validation = fileManagerRef.current.validateFiles(selectedFiles);

    if (validation.videoFiles.length === 0) {
      setError("No video files selected for processing.");
      return;
    }

    setIsProcessing(true);
    setShowProgress(true);
    setError("");
    setResults([]);

    try {
      let processResults;

      if (validation.videoFiles.length === 1) {
        // Single file processing
        const videoFile = validation.videoFiles[0];
        const subtitleFile = fileManagerRef.current.findSubtitleWithSameName(
          videoFile,
          selectedFiles,
          config
        );

        if (!subtitleFile) {
          throw new Error(
            `No matching subtitle file found for ${videoFile.name}. Please ensure the subtitle file has the same name as the video file.`
          );
        }

        const result = await condenserEngineRef.current.condenseSingleFile(
          videoFile,
          subtitleFile,
          config,
          1,
          1
        );
        processResults = [result];
      } else {
        // Multiple file processing
        const batchOptions = calculateBatchOptions(validation.videoFiles);
        processResults = await condenserEngineRef.current.condenseMultipleFiles(
          selectedFiles,
          config,
          batchOptions
        );
      }

      if (processResults.length > 0) {
        setResults(processResults);
        condenserEngineRef.current.downloadResults(processResults, config);
      } else {
        setError("No files were successfully processed.");
      }
    } catch (err) {
      console.error("Processing failed:", err);

      let errorMessage = err.message;
      if (errorMessage.includes("Failed to load FFmpeg")) {
        errorMessage =
          "Failed to load FFmpeg. Please check your internet connection and try again.";
      } else if (errorMessage.includes("No subtitle")) {
        errorMessage =
          "No matching subtitle file found. Make sure your subtitle file has the same name as your video file.";
      }

      setError(`Processing failed: ${errorMessage}`);
    } finally {
      setIsProcessing(false);
      setShowProgress(false);
    }
  };

  const calculateBatchOptions = (videoFiles) => {
    const fileCount = videoFiles.length;
    const totalSizeMB =
      videoFiles.reduce((sum, file) => sum + file.size, 0) / (1024 * 1024);
    const avgFileSizeMB = totalSizeMB / fileCount;

    let batchSize = 3;
    let pauseBetweenBatches = 1000;

    if (avgFileSizeMB > 500) {
      batchSize = 1;
      pauseBetweenBatches = 2000;
    } else if (avgFileSizeMB > 200) {
      batchSize = 2;
      pauseBetweenBatches = 1500;
    } else if (fileCount > 30) {
      batchSize = 5;
      pauseBetweenBatches = 500;
    }

    return { batchSize, pauseBetweenBatches, maxConcurrent: 1 };
  };

  const renderFileList = () => {
    if (selectedFiles.length === 0) return null;

    const validation = fileManagerRef.current.validateFiles(selectedFiles);
    const matchingStats = fileManagerRef.current.getMatchingStats(
      validation.videoFiles,
      selectedFiles,
      config
    );

    return (
      <div className="file-list">
        {selectedFiles.map((file, index) => {
          let statusClass = "status-invalid";
          let statusText = "Unsupported";
          let icon = <AlertCircle size={16} />;
          let subtitle = null;

          if (fileManagerRef.current.isVideoFile(file)) {
            statusClass = "status-video";
            statusText = "Video";
            icon = <Film size={16} />;

            // Find matching subtitle
            const matchInfo = matchingStats.matchedFiles.find(
              (m) => m.video === file.name
            );
            if (matchInfo) {
              subtitle = matchInfo.subtitle;
              statusText += ` (${matchInfo.type} match)`;
            } else {
              statusText += " (no subtitle)";
              statusClass += " no-match";
            }
          } else if (fileManagerRef.current.isSubtitleFile(file)) {
            statusClass = "status-subtitle";
            statusText = "Subtitle";
            icon = <FileText size={16} />;
          }

          return (
            <div key={index} className="file-item">
              <div className="file-info">
                <div className="file-name">{file.name}</div>
                <div className="file-size">
                  {fileManagerRef.current.formatFileSize(file.size)}
                </div>
                {subtitle && (
                  <div className="file-subtitle-match">→ {subtitle}</div>
                )}
              </div>
              <div className={`file-status ${statusClass}`}>
                {icon}
                {statusText}
              </div>
            </div>
          );
        })}

        {/* Show matching summary */}
        {validation.videoFiles.length > 0 && (
          <div className="matching-summary">
            <div className="summary-item">
              <CheckCircle size={16} />
              {matchingStats.exactMatches +
                matchingStats.intelligentMatches} of {matchingStats.total}{" "}
              videos have matching subtitles
            </div>
            {matchingStats.intelligentMatches > 0 && (
              <div className="summary-item intelligent">
                <Info size={16} />
                {matchingStats.intelligentMatches} found using intelligent
                pattern matching
              </div>
            )}
            {matchingStats.noMatches > 0 && (
              <div className="summary-item warning">
                <AlertCircle size={16} />
                {matchingStats.noMatches} videos without matching subtitles
              </div>
            )}
          </div>
        )}

        {validation.invalidFiles.length > 0 && (
          <div className="warning-message">
            <AlertCircle size={16} />
            {validation.invalidFiles.length} unsupported file(s) will be
            ignored.
          </div>
        )}
      </div>
    );
  };

  const renderProcessTab = () => (
    <div className="card">
      <div className="card-content">
        <div
          className={`file-drop-zone ${selectedFiles.length > 0 ? "" : ""}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <Upload
            size={48}
            style={{ margin: "0 auto 1rem", color: "var(--text-secondary)" }}
          />
          <h3>Drop video and subtitle files here</h3>
          <p>or</p>
          <button
            className="btn btn-primary"
            onClick={() => document.getElementById("file-input")?.click()}
          >
            <Upload size={16} />
            Select Files
          </button>
          <input
            type="file"
            id="file-input"
            multiple
            accept=".mp4,.mkv,.avi,.mov,.flv,.webm,.mp3,.wav,.flac,.m4a,.aac,.srt,.ass,.ssa,.vtt"
            onChange={handleFileInput}
            style={{ display: "none" }}
          />
        </div>

        {renderFileList()}

        {error && (
          <div className="error-message">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {showProgress && (
          <div className="progress-section">
            {/* File progress header */}
            {progress.totalFiles > 1 && (
              <div className="progress-file-info">
                <h4>Processing file {progress.fileIndex} of {progress.totalFiles}</h4>
                <div className="progress-current-file">📁 {progress.currentFile}</div>
              </div>
            )}
            
            {/* Overall progress bar for multiple files */}
            {progress.totalFiles > 1 && (
              <div className="progress-overall">
                <div className="progress-header">
                  <span className="progress-label">Overall Progress</span>
                  <span className="progress-percentage">
                    {progress.percentComplete?.toFixed(1) || 0}%
                    {progress.estimatedTimeRemaining && (
                      <span className="progress-eta">
                        {" "}- Est. {condenserEngineRef.current?.formatTime(progress.estimatedTimeRemaining)} remaining
                      </span>
                    )}
                  </span>
                </div>
                <div className="progress-bar progress-bar-overall">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${progress.percentComplete || 0}%`,
                    }}
                  />
                </div>
              </div>
            )}
            
            {/* Current stage progress */}
            <div className="progress-stage">
              <div className="progress-header">
                <span className="progress-label">
                  {progress.stage || 'Processing'}
                  {progress.totalFiles === 1 && progress.currentFile && (
                    <span className="progress-filename"> - {progress.currentFile}</span>
                  )}
                </span>
                <span className="progress-percentage">
                  {progress.total > 0 ? 
                    `${Math.round(progress.currentFileProgress || 0)}% (${progress.progress}/${progress.total})` : 
                    `${Math.round(progress.currentFileProgress || 0)}%`
                  }
                </span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{
                    width: `${progress.currentFileProgress || 0}%`,
                  }}
                />
              </div>
              <div className="progress-message">
                {progress.message}
              </div>
            </div>
          </div>
        )}

        <button
          className={`btn ${
            isProcessing
              ? "btn-danger"
              : selectedFiles.filter((f) =>
                  fileManagerRef.current.isVideoFile(f)
                ).length > 0
              ? "btn-success"
              : "btn-secondary"
          }`}
          onClick={startProcessing}
          disabled={
            !isProcessing &&
            selectedFiles.filter((f) => fileManagerRef.current.isVideoFile(f))
              .length === 0
          }
          style={{ width: "100%", marginTop: "1rem" }}
        >
          {isProcessing ? (
            <>
              <Square size={16} />
              Stop Processing
            </>
          ) : selectedFiles.filter((f) => fileManagerRef.current.isVideoFile(f))
              .length > 0 ? (
            <>
              <Scissors size={16} />
              Process{" "}
              {
                selectedFiles.filter((f) =>
                  fileManagerRef.current.isVideoFile(f)
                ).length
              }{" "}
              video file(s)
            </>
          ) : (
            <>
              <Upload size={16} />
              Select files to start processing
            </>
          )}
        </button>

        {results.length > 0 && (
          <div className="results-section">
            <h3 style={{ marginBottom: "1rem" }}>Processing Results</h3>
            {results.map((result, index) => {
              const compressionRatio = (
                ((result.originalDuration - result.condensedDuration) /
                  result.originalDuration) *
                100
              ).toFixed(1);

              return (
                <div key={index} className="result-item">
                  <div className="result-info">
                    <h4>
                      {fileManagerRef.current.generateOutputFilename(
                        result.originalFilename,
                        config.outputFormat
                      )}
                    </h4>
                    <div className="result-stats">
                      Original:{" "}
                      {fileManagerRef.current.formatDuration(
                        result.originalDuration
                      )}{" "}
                      → Condensed:{" "}
                      {fileManagerRef.current.formatDuration(
                        result.condensedDuration
                      )}
                      ({compressionRatio}% shorter, {result.periodsCount}{" "}
                      segments)
                    </div>
                  </div>
                  <button className="btn btn-primary">
                    <Download size={16} />
                    Re-download
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const renderConfigTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      <div className="card">
        <div className="card-header">
          <h3>Audio Processing Settings</h3>
        </div>
        <div className="card-content">
          <div className="config-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="padding">
                Padding (ms)
              </label>
              <input
                type="number"
                id="padding"
                className="form-input"
                min="0"
                max="60000"
                value={config.padding || 500}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    padding: parseInt(e.target.value) || 500,
                  }))
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="output-format">
                Output Format
              </label>
              <select
                id="output-format"
                className="form-select"
                value={config.outputFormat || "mp3"}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    outputFormat: e.target.value,
                  }))
                }
              >
                <option value="mp3">MP3</option>
                <option value="flac">FLAC</option>
                <option value="wav">WAV</option>
                <option value="aac">AAC</option>
                <option value="ogg">OGG</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Subtitle Filtering</h3>
        </div>
        <div className="card-content">
          <div className="config-grid">
            <div className="form-checkbox">
              <input
                type="checkbox"
                id="filter-parentheses"
                checked={config.filterParentheses || false}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    filterParentheses: e.target.checked,
                  }))
                }
              />
              <label htmlFor="filter-parentheses">
                Filter text in parentheses/brackets
              </label>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="filtered-characters">
                Filtered Characters
              </label>
              <input
                type="text"
                id="filtered-characters"
                className="form-input"
                value={config.filteredCharacters || "♩♪♫♬〜〜"}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    filteredCharacters: e.target.value,
                  }))
                }
                placeholder="Characters to filter out"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="sub-suffix">
                Subtitle Suffix
              </label>
              <input
                type="text"
                id="sub-suffix"
                className="form-input"
                value={config.subSuffix || ""}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, subSuffix: e.target.value }))
                }
                placeholder="e.g., _en, _retimed"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Output Options</h3>
        </div>
        <div className="card-content">
          <div className="config-grid">
            <div className="form-checkbox">
              <input
                type="checkbox"
                id="output-condensed-subtitles"
                checked={config.outputCondensedSubtitles || false}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    outputCondensedSubtitles: e.target.checked,
                  }))
                }
              />
              <label htmlFor="output-condensed-subtitles">
                Output condensed subtitles
              </label>
            </div>
            <div className="form-group">
              <label
                className="form-label"
                htmlFor="condensed-subtitles-format"
              >
                Subtitle Format
              </label>
              <select
                id="condensed-subtitles-format"
                className="form-select"
                value={config.condensedSubtitlesFormat || "srt"}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    condensedSubtitlesFormat: e.target.value,
                  }))
                }
              >
                <option value="srt">SRT</option>
                <option value="lrc">LRC</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderAboutTab = () => (
    <div className="card">
      <div className="card-header">
        <h3>About ScriptSnip</h3>
      </div>
      <div className="card-content">
        <p
          style={{
            marginBottom: "2rem",
            fontSize: "1.1rem",
            lineHeight: "1.7",
          }}
        >
          ScriptSnip extracts speech audio from video files based on subtitle
          timing, creating condensed audio perfect for language immersion
          learning.
        </p>

        <h4 style={{ marginBottom: "1rem", color: "var(--text-primary)" }}>
          How it works:
        </h4>
        <ol
          style={{
            marginBottom: "2rem",
            paddingLeft: "1.5rem",
            lineHeight: "1.7",
          }}
        >
          <li>Upload video files and corresponding subtitle files</li>
          <li>The tool analyzes subtitle timing to identify speech periods</li>
          <li>Audio is extracted and segmented based on these periods</li>
          <li>Segments are concatenated into condensed audio</li>
          <li>Download the result for efficient language practice</li>
        </ol>

        <h4 style={{ marginBottom: "1rem", color: "var(--text-primary)" }}>
          Supported formats:
        </h4>
        <div style={{ marginBottom: "2rem", lineHeight: "1.7" }}>
          <p>
            <strong>Video:</strong> MP4, MKV, AVI, MOV, FLV, WebM, MP3, WAV,
            FLAC, M4A, AAC
          </p>
          <p>
            <strong>Subtitles:</strong> SRT, ASS, SSA, VTT
          </p>
          <p>
            <strong>Output:</strong> MP3, FLAC, WAV, AAC, OGG
          </p>
        </div>

        <h4 style={{ marginBottom: "1rem", color: "var(--text-primary)" }}>
          Privacy:
        </h4>
        <p
          style={{
            marginBottom: "2rem",
            lineHeight: "1.7",
            color: "var(--text-secondary)",
          }}
        >
          All processing happens locally in your browser. No files are uploaded
          to any server.
        </p>

        <h4 style={{ marginBottom: "1rem", color: "var(--text-primary)" }}>
          Intelligent File Matching:
        </h4>
        <p
          style={{
            marginBottom: "1rem",
            lineHeight: "1.7",
            color: "var(--text-secondary)",
          }}
        >
          ScriptSnip includes intelligent pattern-based file matching that can
          pair video and subtitle files even when their names don't exactly
          match. It recognizes episode numbers in various formats including
          bracketed numbers [01], season/episode patterns S01E01, and episode
          prefixes like "Episode 01".
        </p>

        <h4 style={{ marginBottom: "1rem", color: "var(--text-primary)" }}>
          Example file patterns that will be automatically matched:
        </h4>
        <div
          style={{
            fontFamily: "monospace",
            background: "var(--bg-secondary)",
            padding: "1rem",
            borderRadius: "8px",
            marginBottom: "2rem",
          }}
        >
          <p style={{ margin: "0.5rem 0", color: "var(--text-primary)" }}>
            Video: [VCB-Studio] Fullmetal Alchemist Brotherhood [01][1080p].mkv
          </p>
          <p style={{ margin: "0.5rem 0", color: "var(--text-primary)" }}>
            Subtitle: Fullmetal Alchemist - Brotherhood S01E01 jpn.srt
          </p>
          <p style={{ margin: "0.5rem 0", color: "var(--success)" }}>
            → Automatically matched by episode number "01"
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="logo">
            <Scissors size={28} />
            <div>
              <h1>ScriptSnip</h1>
              <p>Audio condensing from video files and subtitles</p>
            </div>
          </div>
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === "light" ? <Sun size={18} /> : <Moon size={18} />}
            {theme === "light" ? "Light" : "Dark"} Mode
          </button>
        </div>
      </header>

      <main className="main-content">
        <div className="tabs">
          <button
            className={`tab ${activeTab === "process" ? "active" : ""}`}
            onClick={() => setActiveTab("process")}
          >
            <Play size={16} />
            Process Files
          </button>
          <button
            className={`tab ${activeTab === "config" ? "active" : ""}`}
            onClick={() => setActiveTab("config")}
          >
            <Settings size={16} />
            Configuration
          </button>
          <button
            className={`tab ${activeTab === "about" ? "active" : ""}`}
            onClick={() => setActiveTab("about")}
          >
            <Info size={16} />
            About
          </button>
        </div>

        {activeTab === "process" && renderProcessTab()}
        {activeTab === "config" && renderConfigTab()}
        {activeTab === "about" && renderAboutTab()}
      </main>
    </div>
  );
}

export default App;
