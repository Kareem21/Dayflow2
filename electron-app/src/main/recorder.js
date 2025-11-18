const { desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class ScreenRecorder {
  constructor(db) {
    this.db = db;
    this.isRecording = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.currentChunkStartTime = null;
    this.chunkInterval = null;
    this.recordingsDir = path.join(app.getPath('userData'), 'recordings');
    this.currentStream = null;
    this.sourceId = null;

    // Ensure recordings directory exists
    if (!fs.existsSync(this.recordingsDir)) {
      fs.mkdirSync(this.recordingsDir, { recursive: true });
    }
  }

  async startRecording(sourceId = null) {
    if (this.isRecording) {
      console.log('Already recording');
      return;
    }

    try {
      // Get screen sources
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      });

      if (sources.length === 0) {
        throw new Error('No screen sources available');
      }

      // Use provided sourceId or default to primary screen
      const source = sourceId
        ? sources.find(s => s.id === sourceId)
        : sources[0];

      if (!source) {
        throw new Error('Screen source not found');
      }

      this.sourceId = source.id;

      // Create media stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: source.id,
            minWidth: 1280,
            maxWidth: 1920,
            minHeight: 720,
            maxHeight: 1080,
            frameRate: { ideal: 1, max: 1 } // 1 FPS
          }
        }
      });

      this.currentStream = stream;

      // Create MediaRecorder
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp8',
        videoBitsPerSecond: 2500000 // 2.5 Mbps
      });

      this.recordedChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        await this.saveChunk();
      };

      // Start recording
      this.mediaRecorder.start();
      this.isRecording = true;
      this.currentChunkStartTime = Date.now();

      // Set up chunk interval (15 seconds)
      this.chunkInterval = setInterval(() => {
        this.rotateChunk();
      }, 15000);

      console.log('Recording started');
    } catch (error) {
      console.error('Failed to start recording:', error);
      this.cleanup();
      throw error;
    }
  }

  stopRecording() {
    if (!this.isRecording) {
      return;
    }

    console.log('Stopping recording');

    // Clear interval
    if (this.chunkInterval) {
      clearInterval(this.chunkInterval);
      this.chunkInterval = null;
    }

    // Stop media recorder
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    this.cleanup();
    this.isRecording = false;
  }

  async rotateChunk() {
    if (!this.isRecording || !this.mediaRecorder) {
      return;
    }

    try {
      // Stop current recording
      this.mediaRecorder.stop();

      // Wait a bit for ondataavailable to fire
      await new Promise(resolve => setTimeout(resolve, 100));

      // Start new chunk if still recording
      if (this.isRecording) {
        this.mediaRecorder.start();
        this.recordedChunks = [];
        this.currentChunkStartTime = Date.now();
      }
    } catch (error) {
      console.error('Failed to rotate chunk:', error);
    }
  }

  async saveChunk() {
    if (this.recordedChunks.length === 0) {
      return;
    }

    try {
      const endTime = Date.now();
      const startTime = this.currentChunkStartTime;
      const duration = (endTime - startTime) / 1000; // in seconds

      // Create blob from chunks
      const blob = new Blob(this.recordedChunks, { type: 'video/webm' });

      // Generate filename
      const filename = `chunk_${startTime}_${endTime}.webm`;
      const filePath = path.join(this.recordingsDir, filename);

      // Convert blob to buffer and save
      const buffer = Buffer.from(await blob.arrayBuffer());
      fs.writeFileSync(filePath, buffer);

      // Save to database
      this.db.saveChunk({
        startTime: startTime,
        endTime: endTime,
        duration: duration,
        filePath: filePath,
        fileSize: buffer.length
      });

      console.log(`Saved chunk: ${filename} (${duration.toFixed(2)}s, ${(buffer.length / 1024 / 1024).toFixed(2)}MB)`);

      this.recordedChunks = [];
    } catch (error) {
      console.error('Failed to save chunk:', error);
    }
  }

  cleanup() {
    // Stop stream tracks
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(track => track.stop());
      this.currentStream = null;
    }

    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.currentChunkStartTime = null;
    this.sourceId = null;
  }

  getRecordingsPath() {
    return this.recordingsDir;
  }
}

module.exports = ScreenRecorder;
