/**
 * Intelligent File Matcher
 * 
 * This module handles intelligent matching of video and subtitle files based on
 * episode numbering patterns, even when the filenames don't exactly match.
 * 
 * Enhanced with cross-format matching:
 * - Sequential ↔ Seasonal episode numbering
 * - Automatic detection of cross-format patterns
 * - Mapping across season boundaries
 * 
 * Example patterns it can handle:
 * Video: [VCB-Studio] Fullmetal Alchemist: Brotherhood [01][Ma10p_1080p][x265_flac].mkv
 * Subtitle: Fullmetal Alchemist - Brotherhood S01E01 the First Day jpn.srt
 * 
 * Cross-format examples:
 * Video [14] → Subtitle S02E01 (if S1 had 13 episodes)
 * Video S02E01 → Subtitle Episode 14 (reverse scenario)
 */

export class IntelligentFileMatcher {
  constructor() {
    // Common episode number patterns (ordered by specificity)
    this.episodePatterns = [
      // Season and Episode patterns
      /S(\d+)E(\d+)/i,           // S01E01, S1E1
      /Season\s*(\d+).*Episode\s*(\d+)/i, // Season 1 Episode 1
      /(\d+)x(\d+)/,             // 1x01, 01x01
      
      // Bracketed episode numbers
      /\[(\d+)\]/,               // [01], [1]
      /\((\d+)\)/,               // (01), (1)
      
      // Episode with prefix
      /(?:Episode|Ep|E)[\s\-_]*(\d+)/i, // Episode 01, Ep01, E01
      
      // Standalone numbers (with word boundaries or separators)
      /(?:^|[\s\-_\.\[\(])(\d{2,3})(?:[\s\-_\.\]\)]|$)/, // 01, 001 (2-3 digits)
      /(?:^|[\s\-_\.\[\(])(\d{1})(?:[\s\-_\.\]\)]|$)/,   // 1 (single digit, less specific)
    ];

    // Common separators and noise words to ignore when comparing base names
    this.separators = /[\s\-_\.\[\]\(\)]/g;
    this.noiseWords = new Set([
      'episode', 'ep', 'season', 'series', 'vol', 'volume', 'part', 'pt',
      'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
      'bd', 'bluray', 'dvd', 'web', 'webrip', 'bdrip', 'hdtv',
      'x264', 'x265', 'h264', 'h265', 'avc', 'hevc',
      'flac', 'aac', 'mp3', 'dts', 'ac3',
      '1080p', '720p', '480p', '4k', 'uhd', 'hd',
      'jpn', 'eng', 'sub', 'dub', 'subbed', 'dubbed',
      'vcb', 'studio', 'group', 'release'
    ]);
  }

  /**
   * Find the best matching subtitle file for a given video file
   * Enhanced with cross-format matching (sequential ↔ seasonal)
   * @param {File} videoFile - The video file to match
   * @param {File[]} subtitleFiles - Array of available subtitle files
   * @param {Object} config - Configuration object
   * @returns {File|null} - Best matching subtitle file or null
   */
  findBestSubtitleMatch(videoFile, subtitleFiles, config = {}) {
    if (!videoFile || !subtitleFiles || subtitleFiles.length === 0) {
      return null;
    }

    const videoInfo = this.analyzeFilename(videoFile.name);
    const matches = [];

    // First, try direct matching
    for (const subtitleFile of subtitleFiles) {
      const subtitleInfo = this.analyzeFilename(subtitleFile.name);
      const score = this.calculateMatchScore(videoInfo, subtitleInfo);
      
      if (score > 0) {
        matches.push({
          file: subtitleFile,
          score: score,
          videoInfo: videoInfo,
          subtitleInfo: subtitleInfo,
          matchType: 'direct'
        });
      }
    }

    // If no good direct matches found, try cross-format matching
    if (matches.length === 0 || matches[0].score < this.getMinimumMatchScore()) {
      const allVideoFiles = config.allVideoFiles || [videoFile];
      const crossFormatMatches = this.findCrossFormatMatches(videoFile, subtitleFiles, allVideoFiles);
      matches.push(...crossFormatMatches);
    }

    // Sort by score (highest first) and return the best match
    matches.sort((a, b) => b.score - a.score);
    
    if (matches.length > 0 && matches[0].score >= this.getMinimumMatchScore()) {
      return matches[0].file;
    }

    return null;
  }

  /**
   * Find matches for multiple video files
   * Enhanced with cross-format detection
   * @param {File[]} videoFiles - Array of video files
   * @param {File[]} subtitleFiles - Array of subtitle files
   * @param {Object} config - Configuration object
   * @returns {Array} - Array of match results
   */
  findMultipleMatches(videoFiles, subtitleFiles, config = {}) {
    const results = [];
    const usedSubtitles = new Set();

    // Build cross-format mapping once for efficiency
    const seasonMapping = this.buildSeasonEpisodeMapping(videoFiles, subtitleFiles);
    
    for (const videoFile of videoFiles) {
      const enhancedConfig = {
        ...config,
        allVideoFiles: videoFiles,
        seasonMapping: seasonMapping
      };
      
      const availableSubtitles = subtitleFiles.filter(sub => !usedSubtitles.has(sub));
      const match = this.findBestSubtitleMatch(videoFile, availableSubtitles, enhancedConfig);
      
      results.push({
        videoFile: videoFile,
        subtitleFile: match,
        matched: match !== null,
        crossFormat: seasonMapping !== null
      });

      if (match) {
        usedSubtitles.add(match);
      }
    }

    return results;
  }

  /**
   * Analyze a filename to extract useful matching information
   * @param {string} filename - The filename to analyze
   * @returns {Object} - Analysis result with extracted information
   */
  analyzeFilename(filename) {
    const baseName = this.getBaseName(filename);
    const cleanName = this.cleanFilename(baseName);
    
    // Extract episode information using patterns
    const episodeInfo = this.extractEpisodeInfo(baseName);
    
    // Extract series/title information
    const titleInfo = this.extractTitleInfo(cleanName, episodeInfo);

    return {
      originalName: filename,
      baseName: baseName,
      cleanName: cleanName,
      title: titleInfo.title,
      titleWords: titleInfo.words,
      episode: episodeInfo.episode,
      season: episodeInfo.season,
      episodePattern: episodeInfo.pattern,
      confidence: episodeInfo.confidence
    };
  }

  /**
   * Calculate match score between video and subtitle file info
   * @param {Object} videoInfo - Video file analysis
   * @param {Object} subtitleInfo - Subtitle file analysis
   * @returns {number} - Match score (0-100)
   */
  calculateMatchScore(videoInfo, subtitleInfo) {
    let score = 0;

    // Episode number match (most important)
    if (videoInfo.episode !== null && subtitleInfo.episode !== null) {
      if (videoInfo.episode === subtitleInfo.episode) {
        score += 50; // High score for exact episode match
        
        // Season match bonus (if both have season info)
        if (videoInfo.season !== null && subtitleInfo.season !== null) {
          if (videoInfo.season === subtitleInfo.season) {
            score += 20;
          } else {
            score -= 10; // Penalty for season mismatch
          }
        }
      } else {
        return 0; // No match if episode numbers don't match
      }
    } else {
      return 0; // No match if we can't extract episode numbers
    }

    // Title similarity
    const titleSimilarity = this.calculateTitleSimilarity(videoInfo.titleWords, subtitleInfo.titleWords);
    score += titleSimilarity * 20; // Up to 20 points for title similarity

    // Pattern consistency bonus
    if (videoInfo.episodePattern === subtitleInfo.episodePattern) {
      score += 5;
    }

    // Confidence penalty for low-confidence episode extraction
    if (videoInfo.confidence < 0.8 || subtitleInfo.confidence < 0.8) {
      score -= 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Extract episode and season information from filename
   * @param {string} filename - The filename to analyze
   * @returns {Object} - Episode information
   */
  extractEpisodeInfo(filename) {
    let bestMatch = null;
    let highestConfidence = 0;
    let matchedPattern = null;

    for (let i = 0; i < this.episodePatterns.length; i++) {
      const pattern = this.episodePatterns[i];
      const match = filename.match(pattern);
      
      if (match) {
        let episode, season = null;
        let confidence = 1.0 - (i * 0.1); // Earlier patterns have higher confidence

        if (match.length === 3) {
          // Two capture groups: season and episode
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else {
          // One capture group: episode only
          episode = parseInt(match[1]);
        }

        // Adjust confidence based on context
        if (this.isLikelyEpisodeNumber(episode, filename)) {
          confidence += 0.1;
        }

        if (confidence > highestConfidence) {
          highestConfidence = confidence;
          bestMatch = { episode, season };
          matchedPattern = i;
        }
      }
    }

    return {
      episode: bestMatch?.episode || null,
      season: bestMatch?.season || null,
      pattern: matchedPattern,
      confidence: highestConfidence
    };
  }

  /**
   * Extract title information from cleaned filename
   * @param {string} cleanName - Cleaned filename
   * @param {Object} episodeInfo - Episode information
   * @returns {Object} - Title information
   */
  extractTitleInfo(cleanName, episodeInfo) {
    // Remove episode-related text to get cleaner title
    let title = cleanName;
    
    // Remove common episode indicators
    title = title.replace(/(?:episode|ep|e)\s*\d+/gi, '');
    title = title.replace(/s\d+e\d+/gi, '');
    title = title.replace(/\d+x\d+/g, '');
    title = title.replace(/\[\d+\]/g, '');
    title = title.replace(/\(\d+\)/g, '');
    
    // Split into words and filter noise
    const words = title.toLowerCase()
      .split(this.separators)
      .filter(word => word.length > 0 && !this.noiseWords.has(word))
      .filter(word => !/^\d+$/.test(word)); // Remove standalone numbers

    // Reconstruct clean title
    const cleanTitle = words.join(' ').trim();

    return {
      title: cleanTitle,
      words: words
    };
  }

  /**
   * Calculate similarity between two sets of title words
   * @param {string[]} words1 - First set of words
   * @param {string[]} words2 - Second set of words
   * @returns {number} - Similarity score (0-1)
   */
  calculateTitleSimilarity(words1, words2) {
    if (!words1.length || !words2.length) {
      return 0;
    }

    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    // Jaccard similarity
    return intersection.size / union.size;
  }

  /**
   * Check if a number is likely to be an episode number based on context
   * @param {number} num - The number to check
   * @param {string} filename - The full filename for context
   * @returns {boolean} - Whether it's likely an episode number
   */
  isLikelyEpisodeNumber(num, filename) {
    // Episode numbers are typically 1-999
    if (num < 1 || num > 999) {
      return false;
    }

    // Check for year patterns (which we want to avoid)
    if (num >= 1900 && num <= 2030) {
      // Could be a year, check context
      const yearPattern = new RegExp(`\\b${num}\\b`);
      const context = filename.match(new RegExp(`.{0,10}${num}.{0,10}`, 'i'));
      if (context && /(?:19|20)\d{2}/.test(context[0])) {
        return false; // Likely a year
      }
    }

    return true;
  }

  /**
   * Clean filename for better comparison
   * @param {string} filename - The filename to clean
   * @returns {string} - Cleaned filename
   */
  cleanFilename(filename) {
    return filename
      .replace(/[\[\]]/g, ' ') // Replace brackets with spaces
      .replace(/[_\-]/g, ' ')   // Replace underscores and hyphens with spaces
      .replace(/\s+/g, ' ')     // Normalize multiple spaces
      .trim();
  }

  /**
   * Get base filename without extension
   * @param {string} filename - The filename
   * @returns {string} - Base filename
   */
  getBaseName(filename) {
    const lastDot = filename.lastIndexOf('.');
    return lastDot === -1 ? filename : filename.substring(0, lastDot);
  }

  /**
   * Get minimum match score required for a valid match
   * @returns {number} - Minimum score
   */
  getMinimumMatchScore() {
    return 40; // Require at least 40% confidence
  }

  /**
   * Get detailed matching analysis for debugging
   * @param {File} videoFile - Video file
   * @param {File[]} subtitleFiles - Subtitle files
   * @returns {Object} - Detailed analysis
   */
  getMatchingAnalysis(videoFile, subtitleFiles) {
    const videoInfo = this.analyzeFilename(videoFile.name);
    const analysis = {
      videoFile: videoFile.name,
      videoInfo: videoInfo,
      candidates: []
    };

    for (const subtitleFile of subtitleFiles) {
      const subtitleInfo = this.analyzeFilename(subtitleFile.name);
      const score = this.calculateMatchScore(videoInfo, subtitleInfo);
      
      analysis.candidates.push({
        subtitleFile: subtitleFile.name,
        subtitleInfo: subtitleInfo,
        score: score,
        wouldMatch: score >= this.getMinimumMatchScore()
      });
    }

    analysis.candidates.sort((a, b) => b.score - a.score);
    return analysis;
  }

  /**
   * Find cross-format matches (sequential ↔ seasonal)
   * @param {File} videoFile - Single video file
   * @param {File[]} subtitleFiles - Available subtitle files
   * @param {File[]} allVideoFiles - All video files for context
   * @returns {Array} - Cross-format matches
   */
  findCrossFormatMatches(videoFile, subtitleFiles, allVideoFiles) {
    const videoInfo = this.analyzeFilename(videoFile.name);
    const matches = [];

    // Build season mapping based on all files
    const seasonMapping = this.buildSeasonEpisodeMapping(allVideoFiles, subtitleFiles);

    if (!seasonMapping) {
      return matches; // No cross-format pattern detected
    }

    for (const subtitleFile of subtitleFiles) {
      const subtitleInfo = this.analyzeFilename(subtitleFile.name);
      const crossFormatScore = this.calculateCrossFormatScore(videoInfo, subtitleInfo, seasonMapping);
      
      if (crossFormatScore > 0) {
        matches.push({
          file: subtitleFile,
          score: crossFormatScore,
          videoInfo: videoInfo,
          subtitleInfo: subtitleInfo,
          matchType: 'cross-format'
        });
      }
    }

    return matches;
  }

  /**
   * Build a mapping between sequential and seasonal episode numbering
   * @param {File[]} videoFiles - Video files to analyze
   * @param {File[]} subtitleFiles - Subtitle files to analyze
   * @returns {Object|null} - Season mapping or null if not needed
   */
  buildSeasonEpisodeMapping(videoFiles, subtitleFiles) {
    const videoInfos = videoFiles.map(f => this.analyzeFilename(f.name));
    const subtitleInfos = subtitleFiles.map(f => this.analyzeFilename(f.name));

    // Detect format types
    const videoHasSeasonal = videoInfos.some(info => info.season !== null);
    const videoHasSequential = videoInfos.some(info => info.season === null && info.episode !== null);
    const subtitleHasSeasonal = subtitleInfos.some(info => info.season !== null);
    const subtitleHasSequential = subtitleInfos.some(info => info.season === null && info.episode !== null);

    // Determine if we need cross-format mapping
    const needsCrossFormat = (videoHasSeasonal && subtitleHasSequential) || 
                            (videoHasSequential && subtitleHasSeasonal);

    if (!needsCrossFormat) {
      return null;
    }

    // Build the mapping
    let seasonalInfos, direction;

    if (videoHasSeasonal && subtitleHasSequential) {
      seasonalInfos = videoInfos.filter(info => info.season !== null);
      direction = 'toSequential';
    } else {
      seasonalInfos = subtitleInfos.filter(info => info.season !== null);
      direction = 'toSeasonal';
    }

    // Group seasonal episodes by season
    const seasonGroups = {};
    seasonalInfos.forEach(info => {
      if (!seasonGroups[info.season]) {
        seasonGroups[info.season] = [];
      }
      seasonGroups[info.season].push(info.episode);
    });

    // Sort seasons and calculate episode counts
    const sortedSeasons = Object.keys(seasonGroups).map(Number).sort((a, b) => a - b);
    const episodeCounts = {};
    
    sortedSeasons.forEach(season => {
      seasonGroups[season].sort((a, b) => a - b);
      episodeCounts[season] = Math.max(...seasonGroups[season]);
    });

    // Create bidirectional mapping
    const mapping = {
      direction: direction,
      seasonToSequential: new Map(),
      sequentialToSeason: new Map(),
      episodeCounts: episodeCounts
    };

    let sequentialCounter = 1;
    sortedSeasons.forEach(season => {
      for (let episode = 1; episode <= episodeCounts[season]; episode++) {
        mapping.seasonToSequential.set(`S${season}E${episode}`, sequentialCounter);
        mapping.sequentialToSeason.set(sequentialCounter, { season, episode });
        sequentialCounter++;
      }
    });

    return mapping;
  }

  /**
   * Calculate cross-format match score
   * @param {Object} videoInfo - Video file analysis
   * @param {Object} subtitleInfo - Subtitle file analysis  
   * @param {Object} seasonMapping - Season mapping object
   * @returns {number} - Match score (0-100)
   */
  calculateCrossFormatScore(videoInfo, subtitleInfo, seasonMapping) {
    let score = 0;
    let videoEpisode, subtitleEpisode;

    // Convert both to sequential for comparison
    if (seasonMapping.direction === 'toSequential') {
      // Video is seasonal, subtitle is sequential
      if (videoInfo.season !== null && videoInfo.episode !== null) {
        const seasonKey = `S${videoInfo.season}E${videoInfo.episode}`;
        videoEpisode = seasonMapping.seasonToSequential.get(seasonKey);
      }
      subtitleEpisode = subtitleInfo.episode;
    } else {
      // Video is sequential, subtitle is seasonal
      videoEpisode = videoInfo.episode;
      if (subtitleInfo.season !== null && subtitleInfo.episode !== null) {
        const seasonKey = `S${subtitleInfo.season}E${subtitleInfo.episode}`;
        subtitleEpisode = seasonMapping.seasonToSequential.get(seasonKey);
      }
    }

    // Check if episodes match
    if (videoEpisode !== null && subtitleEpisode !== null && videoEpisode === subtitleEpisode) {
      score += 45; // Slightly lower than direct match but still high

      // Title similarity bonus
      const titleSimilarity = this.calculateTitleSimilarity(videoInfo.titleWords, subtitleInfo.titleWords);
      score += titleSimilarity * 15;

      // Cross-format bonus
      score += 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Test the matcher with sample filenames
   * @param {string} videoFilename - Video filename to test
   * @param {string[]} subtitleFilenames - Subtitle filenames to test
   * @returns {Object} - Test results
   */
  testMatcher(videoFilename, subtitleFilenames) {
    // Create mock file objects
    const videoFile = { name: videoFilename };
    const subtitleFiles = subtitleFilenames.map(name => ({ name }));
    
    return this.getMatchingAnalysis(videoFile, subtitleFiles);
  }

  /**
   * Test cross-format matching specifically
   * @param {string[]} videoFilenames - Video filenames
   * @param {string[]} subtitleFilenames - Subtitle filenames
   * @returns {Object} - Cross-format test results
   */
  testCrossFormatMatching(videoFilenames, subtitleFilenames) {
    const videoFiles = videoFilenames.map(name => ({ name }));
    const subtitleFiles = subtitleFilenames.map(name => ({ name }));
    
    const matches = this.findMultipleMatches(videoFiles, subtitleFiles);
    const successful = matches.filter(m => m.matched).length;
    
    return {
      matches: matches,
      successful: successful,
      total: matches.length,
      successRate: ((successful / matches.length) * 100).toFixed(1) + '%'
    };
  }
}
