const VideoProcessor = require('./video-processor');

class AnalysisManager {
  constructor(db, llmService) {
    this.db = db;
    this.llmService = llmService;
    this.videoProcessor = new VideoProcessor();
    this.interval = null;
    this.isProcessing = false;

    // Configuration
    this.MIN_BATCH_DURATION = 5 * 60; // 5 minutes minimum
    this.TARGET_BATCH_DURATION = 15 * 60; // 15 minutes target
    this.MAX_GAP_DURATION = 2 * 60; // 2 minutes max gap between chunks
  }

  start() {
    if (this.interval) {
      console.log('Analysis manager already running');
      return;
    }

    console.log('Starting analysis manager');

    // Initialize LLM service
    this.llmService.initialize();

    // Run every 60 seconds
    this.interval = setInterval(() => {
      this.processUnprocessedChunks();
    }, 60000);

    // Run immediately on start
    this.processUnprocessedChunks();
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('Stopped analysis manager');
    }
  }

  async processUnprocessedChunks() {
    if (this.isProcessing) {
      console.log('Already processing, skipping...');
      return;
    }

    this.isProcessing = true;

    try {
      // Get unprocessed chunks
      const chunks = this.db.getUnprocessedChunks();

      if (chunks.length === 0) {
        return;
      }

      console.log(`Found ${chunks.length} unprocessed chunks`);

      // Group chunks into batches
      const batches = this.groupChunksIntoBatches(chunks);

      console.log(`Created ${batches.length} batches`);

      // Process each batch
      for (const batch of batches) {
        await this.processBatch(batch);
      }
    } catch (error) {
      console.error('Error processing chunks:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Group chunks into ~15-minute batches
   */
  groupChunksIntoBatches(chunks) {
    if (chunks.length === 0) {
      return [];
    }

    const batches = [];
    let currentBatch = {
      chunks: [],
      startTime: null,
      endTime: null,
      totalDuration: 0
    };

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Start new batch if this is the first chunk
      if (currentBatch.chunks.length === 0) {
        currentBatch.chunks = [chunk];
        currentBatch.startTime = chunk.start_time;
        currentBatch.endTime = chunk.end_time;
        currentBatch.totalDuration = chunk.duration;
        continue;
      }

      // Calculate gap from last chunk
      const lastChunk = currentBatch.chunks[currentBatch.chunks.length - 1];
      const gap = (chunk.start_time - lastChunk.end_time) / 1000; // in seconds

      // Check if we should start a new batch
      const shouldStartNewBatch =
        gap > this.MAX_GAP_DURATION || // Gap too large
        currentBatch.totalDuration >= this.TARGET_BATCH_DURATION; // Batch is long enough

      if (shouldStartNewBatch) {
        // Save current batch if it meets minimum duration
        if (currentBatch.totalDuration >= this.MIN_BATCH_DURATION) {
          // Don't save if this is the most recent batch and it's still growing
          const isRecentBatch = i === chunks.length - 1 &&
            currentBatch.totalDuration < this.TARGET_BATCH_DURATION;

          if (!isRecentBatch) {
            batches.push(currentBatch);
          }
        }

        // Start new batch
        currentBatch = {
          chunks: [chunk],
          startTime: chunk.start_time,
          endTime: chunk.end_time,
          totalDuration: chunk.duration
        };
      } else {
        // Add chunk to current batch
        currentBatch.chunks.push(chunk);
        currentBatch.endTime = chunk.end_time;
        currentBatch.totalDuration += chunk.duration;
      }
    }

    // Add final batch if it meets criteria
    if (currentBatch.chunks.length > 0 && currentBatch.totalDuration >= this.MIN_BATCH_DURATION) {
      // Don't add if it's too short (still accumulating)
      if (currentBatch.totalDuration >= this.TARGET_BATCH_DURATION * 0.8) {
        batches.push(currentBatch);
      }
    }

    return batches;
  }

  /**
   * Process a single batch
   */
  async processBatch(batch) {
    try {
      console.log(`Processing batch: ${new Date(batch.startTime).toISOString()} - ${new Date(batch.endTime).toISOString()} (${batch.totalDuration.toFixed(0)}s)`);

      // Save batch to database
      const chunkIds = batch.chunks.map(c => c.id);
      const batchId = this.db.saveBatch({
        startTime: batch.startTime,
        endTime: batch.endTime,
        totalDuration: batch.totalDuration,
        chunkCount: batch.chunks.length
      }, chunkIds);

      this.db.updateBatchStatus(batchId, 'processing');

      // Stitch chunks into a single video
      console.log('Creating timelapse...');
      const timelapseVideoPath = await this.videoProcessor.createTimelapse(
        batch.chunks,
        batchId,
        20 // 20x speed
      );

      console.log('Timelapse created, sending to LLM...');

      // Process with LLM
      const activities = await this.llmService.processBatch(batchId, timelapseVideoPath);

      console.log(`LLM returned ${activities.length} activities`);

      // Save timeline cards
      activities.forEach(activity => {
        const cardId = this.db.saveTimelineCard({
          batchId: batchId,
          startTime: batch.startTime + (activity.startOffset * 1000),
          endTime: batch.startTime + ((activity.startOffset + activity.duration) * 1000),
          title: activity.title,
          description: activity.description,
          category: activity.category,
          isDistraction: activity.isDistraction,
          videoPath: timelapseVideoPath
        });

        console.log(`Created timeline card ${cardId}: ${activity.title}`);
      });

      // Mark batch as completed
      this.db.updateBatchStatus(batchId, 'completed');

      console.log(`Batch ${batchId} processed successfully`);
    } catch (error) {
      console.error('Error processing batch:', error);

      // Mark as failed if batch was saved
      if (batch.id) {
        this.db.updateBatchStatus(batch.id, 'failed');
      }
    }
  }

  /**
   * Manually trigger processing of pending batches
   */
  async processPendingBatches() {
    const batches = this.db.getPendingBatches();

    console.log(`Processing ${batches.length} pending batches`);

    for (const batch of batches) {
      // Get chunks for this batch
      const chunks = this.db.getBatchChunks(batch.id);

      await this.processBatch({
        id: batch.id,
        chunks: chunks,
        startTime: batch.start_time,
        endTime: batch.end_time,
        totalDuration: batch.total_duration
      });
    }
  }

  /**
   * Clean up old data
   */
  async cleanup() {
    console.log('Running cleanup...');

    // Delete old chunks (3 days)
    this.db.deleteOldChunks(3);

    // Clean up old timelapses (7 days)
    this.videoProcessor.cleanupOldTimelapses(7);

    console.log('Cleanup completed');
  }
}

module.exports = AnalysisManager;
