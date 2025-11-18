const fetch = require('node-fetch');
const fs = require('fs');

class LLMService {
  constructor(db) {
    this.db = db;
    this.provider = null;
    this.apiKey = null;
  }

  initialize() {
    // Get settings from database
    const provider = this.db.getSetting('llm_provider', 'gemini');
    const apiKey = this.db.getSetting('gemini_api_key', '');

    this.provider = provider;
    this.apiKey = apiKey;
  }

  setProvider(provider, apiKey = null) {
    this.provider = provider;
    if (apiKey) {
      this.apiKey = apiKey;
      this.db.setSetting('gemini_api_key', apiKey);
    }
    this.db.setSetting('llm_provider', provider);
  }

  /**
   * Process a batch with the configured LLM provider
   * @param {Number} batchId - Batch ID
   * @param {String} videoPath - Path to stitched video
   * @returns {Promise<Array>} - Array of activity cards
   */
  async processBatch(batchId, videoPath) {
    if (this.provider === 'gemini') {
      return await this.processWithGemini(batchId, videoPath);
    } else if (this.provider === 'ollama') {
      return await this.processWithOllama(batchId, videoPath);
    } else {
      throw new Error(`Unknown provider: ${this.provider}`);
    }
  }

  /**
   * Process with Gemini API (efficient - video understanding)
   */
  async processWithGemini(batchId, videoPath) {
    if (!this.apiKey) {
      throw new Error('Gemini API key not configured');
    }

    try {
      // Read video file as base64
      const videoBuffer = fs.readFileSync(videoPath);
      const videoBase64 = videoBuffer.toString('base64');

      // Prepare the prompt
      const prompt = `Analyze this screen recording and create a timeline of activities.

For each distinct activity or task you observe:
1. Identify what the user was doing (be specific)
2. Categorize it (Work, Meeting, Break, Communication, Research, Development, or Other)
3. Note if it appears to be a distraction (social media, entertainment, etc.)
4. Provide a concise 1-2 sentence description

Return a JSON array of activities in this format:
[
  {
    "title": "Brief activity title",
    "description": "1-2 sentence description of what was happening",
    "category": "Work|Meeting|Break|Communication|Research|Development|Other",
    "isDistraction": false,
    "startOffset": 0,
    "duration": 300
  }
]

Important:
- Each activity should be 3-15 minutes long
- Be concise but specific
- Focus on productive categorization
- Identify distractions honestly`;

      // Call Gemini API
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: prompt
                  },
                  {
                    inline_data: {
                      mime_type: 'video/mp4',
                      data: videoBase64
                    }
                  }
                ]
              }
            ],
            generationConfig: {
              temperature: 0.4,
              topK: 32,
              topP: 1,
              maxOutputTokens: 2048
            }
          })
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini API error: ${error}`);
      }

      const result = await response.json();

      // Extract text from response
      const text = result.candidates[0].content.parts[0].text;

      // Log the call
      this.db.logLLMCall({
        batchId: batchId,
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        promptTokens: result.usageMetadata?.promptTokenCount || 0,
        completionTokens: result.usageMetadata?.candidatesTokenCount || 0,
        response: text
      });

      // Parse JSON from response
      const activities = this.parseActivitiesFromText(text);

      return activities;
    } catch (error) {
      console.error('Gemini processing error:', error);

      // Log the error
      this.db.logLLMCall({
        batchId: batchId,
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Process with Ollama (local - frame by frame)
   */
  async processWithOllama(batchId, videoPath) {
    const ollamaUrl = this.db.getSetting('ollama_url', 'http://localhost:11434');
    const ollamaModel = this.db.getSetting('ollama_model', 'llava');

    try {
      // Extract frames from video (1 frame per 15 seconds)
      const VideoProcessor = require('./video-processor');
      const videoProcessor = new VideoProcessor();
      const frames = await videoProcessor.extractFrames(videoPath, 0.066);

      console.log(`Extracted ${frames.length} frames for analysis`);

      // Analyze each frame
      const frameAnalyses = [];

      for (let i = 0; i < frames.length; i++) {
        const framePath = frames[i];

        // Read frame as base64
        const frameBuffer = fs.readFileSync(framePath);
        const frameBase64 = frameBuffer.toString('base64');

        // Call Ollama
        const response = await fetch(`${ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: ollamaModel,
            prompt: 'Describe what application or activity is visible on this screen. Be very brief (1 sentence).',
            images: [frameBase64],
            stream: false
          })
        });

        if (!response.ok) {
          console.error(`Failed to analyze frame ${i}`);
          continue;
        }

        const result = await response.json();
        frameAnalyses.push({
          frame: i,
          timestamp: i * 15, // 15 seconds per frame
          description: result.response
        });

        console.log(`Frame ${i + 1}/${frames.length}: ${result.response}`);
      }

      // Group similar consecutive frames into activities
      const activities = this.groupFramesIntoActivities(frameAnalyses);

      // Log the call
      this.db.logLLMCall({
        batchId: batchId,
        provider: 'ollama',
        model: ollamaModel,
        response: JSON.stringify(activities)
      });

      // Clean up frames
      const framesDir = require('path').dirname(frames[0]);
      fs.rmSync(framesDir, { recursive: true, force: true });

      return activities;
    } catch (error) {
      console.error('Ollama processing error:', error);

      this.db.logLLMCall({
        batchId: batchId,
        provider: 'ollama',
        model: 'llava',
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Parse activities from LLM response text
   */
  parseActivitiesFromText(text) {
    try {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```\n([\s\S]*?)\n```/);

      let jsonText = jsonMatch ? jsonMatch[1] : text;

      // Try to find array in text
      const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        jsonText = arrayMatch[0];
      }

      const activities = JSON.parse(jsonText);

      // Validate and normalize
      return activities.map(activity => ({
        title: activity.title || 'Unknown Activity',
        description: activity.description || '',
        category: this.normalizeCategory(activity.category),
        isDistraction: Boolean(activity.isDistraction),
        startOffset: activity.startOffset || 0,
        duration: activity.duration || 300
      }));
    } catch (error) {
      console.error('Failed to parse activities:', error);
      return [];
    }
  }

  /**
   * Group frame descriptions into activities
   */
  groupFramesIntoActivities(frameAnalyses) {
    if (frameAnalyses.length === 0) {
      return [];
    }

    const activities = [];
    let currentActivity = null;

    frameAnalyses.forEach((frame, index) => {
      const desc = frame.description.toLowerCase();

      // Simple categorization based on keywords
      let category = 'Other';
      if (desc.includes('code') || desc.includes('editor') || desc.includes('terminal')) {
        category = 'Development';
      } else if (desc.includes('browser') || desc.includes('chrome') || desc.includes('firefox')) {
        category = 'Research';
      } else if (desc.includes('email') || desc.includes('slack') || desc.includes('chat')) {
        category = 'Communication';
      } else if (desc.includes('meeting') || desc.includes('zoom') || desc.includes('video call')) {
        category = 'Meeting';
      }

      const isDistraction = desc.includes('youtube') || desc.includes('social') ||
        desc.includes('facebook') || desc.includes('twitter') || desc.includes('reddit');

      // Check if this is a new activity or continuation
      if (!currentActivity || currentActivity.category !== category) {
        // Save previous activity
        if (currentActivity) {
          activities.push(currentActivity);
        }

        // Start new activity
        currentActivity = {
          title: this.generateTitle(category, frame.description),
          description: frame.description,
          category: category,
          isDistraction: isDistraction,
          startOffset: frame.timestamp,
          duration: 15
        };
      } else {
        // Continue current activity
        currentActivity.duration += 15;
        currentActivity.description += '. ' + frame.description;
      }
    });

    // Add last activity
    if (currentActivity) {
      activities.push(currentActivity);
    }

    return activities;
  }

  generateTitle(category, description) {
    // Generate a brief title based on category and description
    const titles = {
      'Development': 'Coding Session',
      'Research': 'Web Browsing',
      'Communication': 'Messaging',
      'Meeting': 'Video Meeting',
      'Work': 'Work Task',
      'Other': 'Activity'
    };

    return titles[category] || 'Activity';
  }

  normalizeCategory(category) {
    const validCategories = ['Work', 'Meeting', 'Break', 'Communication', 'Research', 'Development', 'Other'];

    // Normalize case and find match
    const normalized = category ? category.trim() : '';
    const match = validCategories.find(c => c.toLowerCase() === normalized.toLowerCase());

    return match || 'Other';
  }
}

module.exports = LLMService;
