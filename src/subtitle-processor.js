export class SubtitleProcessor {
  
  /**
   * Parse subtitle file content into structured entries
   */
  parseSubtitles(content) {
    try {
      const extension = this.detectFormat(content);
      
      switch (extension) {
        case 'srt':
          return this.parseSRT(content);
        case 'vtt':
          return this.parseVTT(content);
        case 'ass':
        case 'ssa':
          return this.parseASS(content);
        default:
          // Try SRT as fallback
          return this.parseSRT(content);
      }
    } catch (error) {
      throw new Error(`Failed to parse subtitles: ${error.message}`);
    }
  }

  /**
   * Detect subtitle format from content
   */
  detectFormat(content) {
    const trimmedContent = content.trim();
    
    if (trimmedContent.startsWith('WEBVTT')) {
      return 'vtt';
    } else if (trimmedContent.includes('[Script Info]') || trimmedContent.includes('[V4+ Styles]')) {
      return 'ass';
    } else {
      return 'srt'; // Default to SRT
    }
  }

  /**
   * Parse SRT subtitle format
   */
  parseSRT(content) {
    const entries = [];
    const blocks = content.trim().split(/\n\s*\n/);

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 3) continue;

      const id = parseInt(lines[0]);
      if (isNaN(id)) continue;

      const timeMatch = lines[1].match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
      if (!timeMatch) continue;

      const startTime = this.parseTime(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
      const endTime = this.parseTime(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
      const text = lines.slice(2).join('\n').trim();

      if (text) {
        entries.push({
          id,
          startTime,
          endTime,
          text
        });
      }
    }

    return entries;
  }

  /**
   * Parse VTT subtitle format
   */
  parseVTT(content) {
    const entries = [];
    const lines = content.split('\n');
    let currentEntry = null;
    let id = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip WEBVTT header and empty lines
      if (!line || line.startsWith('WEBVTT') || line.startsWith('NOTE')) {
        continue;
      }

      // Check for time line
      const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
      if (timeMatch) {
        if (currentEntry) {
          entries.push(currentEntry);
        }

        currentEntry = {
          id: id++,
          startTime: this.parseTime(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]),
          endTime: this.parseTime(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]),
          text: ''
        };
      } else if (currentEntry && line) {
        // Add text line
        currentEntry.text += (currentEntry.text ? '\n' : '') + line;
      }
    }

    if (currentEntry) {
      entries.push(currentEntry);
    }

    return entries;
  }

  /**
   * Parse ASS/SSA subtitle format (basic implementation)
   */
  parseASS(content) {
    const entries = [];
    const lines = content.split('\n');
    let id = 1;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Look for dialogue lines
      if (trimmedLine.startsWith('Dialogue:')) {
        const parts = trimmedLine.substring(9).split(',');
        if (parts.length >= 10) {
          try {
            const startTime = this.parseASSTime(parts[1]);
            const endTime = this.parseASSTime(parts[2]);
            const text = parts.slice(9).join(',').replace(/\{[^}]*\}/g, ''); // Remove ASS tags

            if (text.trim()) {
              entries.push({
                id: id++,
                startTime,
                endTime,
                text: text.trim()
              });
            }
          } catch (error) {
            // Skip invalid lines
            continue;
          }
        }
      }
    }

    return entries;
  }

  /**
   * Parse time in HH:MM:SS,mmm or HH:MM:SS.mmm format
   */
  parseTime(hours, minutes, seconds, milliseconds) {
    return (
      parseInt(hours) * 3600000 +
      parseInt(minutes) * 60000 +
      parseInt(seconds) * 1000 +
      parseInt(milliseconds)
    );
  }

  /**
   * Parse ASS time format (H:MM:SS.cc)
   */
  parseASSTime(timeStr) {
    const match = timeStr.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
    if (!match) throw new Error('Invalid ASS time format');
    
    return (
      parseInt(match[1]) * 3600000 +
      parseInt(match[2]) * 60000 +
      parseInt(match[3]) * 1000 +
      parseInt(match[4]) * 10 // centiseconds to milliseconds
    );
  }

  /**
   * Extract periods from subtitles with filtering and merging (direct port from Python)
   */
  extractPeriods(subtitleContent, config) {
    const subs = this.parseSubtitles(subtitleContent);
    
    if (!subs.length) {
      throw new Error('No subtitle entries found');
    }

    // Apply filtering (direct port from Python filter_text function)
    const filteredSubs = subs.filter(sub => {
      let text = this.stripXmlTags(sub.text);
      
      if (text.length === 0) return false;

      // Filter parentheses (Python logic: filter_parentheses)
      if (config.filterParentheses && this.isEnclosedInParentheses(text)) {
        return false;
      }

      // Filter specific characters (Python logic: filtered_chars)
      if (config.filteredCharacters) {
        text = text.replace(new RegExp(`[${this.escapeRegExp(config.filteredCharacters)}]`, 'g'), '');
      }

      return text.length > 0;
    });

    console.log(`All period count: ${subs.length} (${subs.length - filteredSubs.length} filtered)`);

    // Create periods with padding (direct port from Python)
    let periods = filteredSubs.map(sub => [
      Math.max(0, sub.startTime - config.padding),
      sub.endTime + config.padding
    ]);

    // Adjust last period padding (Python logic)
    if (periods.length > 0) {
      periods[periods.length - 1][1] -= config.padding;
    }

    // Merge overlapping periods (direct port from Python merge logic)
    const mergedPeriods = this.mergeOverlappingPeriods(periods);
    
    console.log(`Merged period count: ${mergedPeriods.length}`);
    
    return mergedPeriods;
  }

  /**
   * Merge overlapping periods (exact port from Python)
   */
  mergeOverlappingPeriods(periods) {
    const merged = [];
    let i = 0;

    while (i < periods.length) {
      let expanded = 0;
      for (let j = i + 1; j < periods.length; j++) {
        if (periods[i][1] >= periods[j][0]) {  // Python condition: periods[i][1] >= periods[j][0]
          periods[i][1] = periods[j][1];
          expanded++;
        } else {
          break;
        }
      }
      merged.push({ start: periods[i][0], end: periods[i][1] });
      i += expanded + 1;
    }

    return merged;
  }

  /**
   * Strip XML/HTML tags (Python: re.sub("<[^<]+?>", "", text))
   */
  stripXmlTags(text) {
    return text.replace(/<[^<>]+?>/g, '');
  }

  /**
   * Check if text is enclosed in parentheses (Python logic)
   */
  isEnclosedInParentheses(text) {
    if (text.length === 0) return false;
    
    const first = text[0];
    const last = text[text.length - 1];
    
    return (
      (first === '(' && last === ')') ||
      (first === '（' && last === '）') ||
      (first === '[' && last === ']') ||
      (first === '{' && last === '}')
    );
  }

  /**
   * Escape special regex characters
   */
  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Create condensed subtitles (port from Python condense_subtitles function)
   */
  createCondensedSubtitles(periods, originalSubtitleContent, format = 'srt') {
    const originalSubs = this.parseSubtitles(originalSubtitleContent);
    const condensedSubs = [];
    let offset = 0;

    for (const period of periods) {
      for (const sub of originalSubs) {
        if (sub.startTime >= period.start && sub.endTime <= period.end) {
          // Adjust subtitle times to condensed timeline
          const adjustedSub = {
            id: condensedSubs.length + 1,
            startTime: sub.startTime - period.start + offset,
            endTime: sub.endTime - period.start + offset,
            text: sub.text
          };
          condensedSubs.push(adjustedSub);
        }
      }

      // Update offset based on period duration
      const periodDuration = period.end - period.start;
      offset += periodDuration;
    }

    if (format === 'lrc') {
      return this.convertToLRC(condensedSubs);
    } else {
      return this.convertToSRT(condensedSubs);
    }
  }

  /**
   * Convert subtitles to SRT format
   */
  convertToSRT(subs) {
    return subs.map(sub => {
      const startTime = this.millisecondsToSRTTime(sub.startTime);
      const endTime = this.millisecondsToSRTTime(sub.endTime);
      return `${sub.id}\n${startTime} --> ${endTime}\n${sub.text}\n`;
    }).join('\n');
  }

  /**
   * Convert subtitles to LRC format (port from Python srt_file_to_lrc)
   */
  convertToLRC(subs) {
    return subs.map(sub => {
      const startTime = this.millisecondsToLRCTime(sub.startTime);
      const endTime = this.millisecondsToLRCTime(sub.endTime);
      const content = sub.text.replace(/\n/g, ' ');
      return `[${startTime}]${content}\n[${endTime}]\n`;
    }).join('');
  }

  /**
   * Convert milliseconds to SRT time format (HH:MM:SS,mmm)
   */
  millisecondsToSRTTime(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = ms % 1000;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
  }

  /**
   * Convert milliseconds to LRC time format (MM:SS.xx)
   */
  millisecondsToLRCTime(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const centiseconds = Math.floor((ms % 1000) / 10);

    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
  }
}
