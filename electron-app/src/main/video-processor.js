const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class VideoProcessor {
  constructor() {
    this.timelapsesDir = path.join(app.getPath('userData'), 'timelapses');

    // Ensure timelapses directory exists
    if (!fs.existsSync(this.timelapsesDir)) {
      fs.mkdirSync(this.timelapsesDir, { recursive: true });
    }
  }

  /**
   * Stitch video chunks together and create a timelapse
   * @param {Array} chunks - Array of chunk objects with file_path
   * @param {Number} batchId - Batch ID for naming
   * @param {Number} speedMultiplier - Speed multiplier (default: 20x)
   * @returns {Promise<String>} - Path to the generated timelapse
   */
  async createTimelapse(chunks, batchId, speedMultiplier = 20) {
    if (!chunks || chunks.length === 0) {
      throw new Error('No chunks provided');
    }

    return new Promise((resolve, reject) => {
      try {
        // Create a temporary concat file list
        const concatFilePath = path.join(this.timelapsesDir, `concat_${batchId}.txt`);
        const outputPath = path.join(this.timelapsesDir, `timelapse_${batchId}.mp4`);

        // Write concat file
        const concatContent = chunks
          .map(chunk => `file '${chunk.file_path.replace(/'/g, "'\\''")}'`)
          .join('\n');

        fs.writeFileSync(concatFilePath, concatContent);

        // Create FFmpeg command
        const command = ffmpeg()
          .input(concatFilePath)
          .inputOptions(['-f concat', '-safe 0'])
          .outputOptions([
            '-c:v libx264',
            '-preset fast',
            '-crf 23',
            `-filter:v setpts=${1 / speedMultiplier}*PTS`,
            '-r 24', // 24 FPS output
            '-pix_fmt yuv420p'
          ])
          .output(outputPath)
          .on('start', (commandLine) => {
            console.log('FFmpeg command:', commandLine);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`Processing: ${progress.percent.toFixed(2)}% done`);
            }
          })
          .on('end', () => {
            console.log(`Timelapse created: ${outputPath}`);

            // Clean up concat file
            try {
              fs.unlinkSync(concatFilePath);
            } catch (error) {
              console.error('Failed to delete concat file:', error);
            }

            resolve(outputPath);
          })
          .on('error', (error) => {
            console.error('FFmpeg error:', error);

            // Clean up concat file
            try {
              if (fs.existsSync(concatFilePath)) {
                fs.unlinkSync(concatFilePath);
              }
            } catch (e) {
              // Ignore
            }

            reject(error);
          });

        // Run the command
        command.run();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Extract frames from a video for AI analysis
   * @param {String} videoPath - Path to the video file
   * @param {Number} fps - Frames per second to extract
   * @returns {Promise<Array>} - Array of frame file paths
   */
  async extractFrames(videoPath, fps = 0.066) {
    // 0.066 fps = 1 frame every 15 seconds
    const framesDir = path.join(this.timelapsesDir, 'frames', `${Date.now()}`);

    if (!fs.existsSync(framesDir)) {
      fs.mkdirSync(framesDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const frames = [];

      ffmpeg(videoPath)
        .outputOptions([
          `-vf fps=${fps}`,
          '-q:v 2' // Quality
        ])
        .output(path.join(framesDir, 'frame_%04d.jpg'))
        .on('end', () => {
          // Get all generated frames
          const files = fs.readdirSync(framesDir)
            .filter(f => f.endsWith('.jpg'))
            .map(f => path.join(framesDir, f))
            .sort();

          resolve(files);
        })
        .on('error', (error) => {
          reject(error);
        })
        .run();
    });
  }

  /**
   * Get video metadata
   * @param {String} videoPath - Path to the video file
   * @returns {Promise<Object>} - Video metadata
   */
  async getVideoMetadata(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (error, metadata) => {
        if (error) {
          reject(error);
        } else {
          resolve(metadata);
        }
      });
    });
  }

  /**
   * Clean up old timelapse files
   * @param {Number} daysToKeep - Number of days to keep files
   */
  cleanupOldTimelapses(daysToKeep = 7) {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

    try {
      const files = fs.readdirSync(this.timelapsesDir);

      files.forEach(file => {
        const filePath = path.join(this.timelapsesDir, file);
        const stats = fs.statSync(filePath);

        if (stats.isFile() && stats.mtimeMs < cutoffTime) {
          fs.unlinkSync(filePath);
          console.log(`Deleted old timelapse: ${file}`);
        }
      });
    } catch (error) {
      console.error('Failed to cleanup timelapses:', error);
    }
  }
}

module.exports = VideoProcessor;
