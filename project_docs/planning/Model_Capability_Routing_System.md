# Model Capability and Routing System Design

<!-- cSpell:ignore lmstudio deepseek nomic qwen Qwen -->

## Overview

This document defines the intelligent model selection and routing system that
automatically chooses the optimal local model for each request based on task
requirements, model capabilities, and system resources.

*Status (2025-09-27): Concept approved; implementation deferred until LMStudio
Phase 2 routing work begins.*

## Model Capability Framework

### Configuration defaults

Providers declare capability preferences in `config/providers*.json` using the
new `defaults` and `scores` keys. Example:

```json
"lmstudio_gpu": {
  "baseUrl": "http://localhost:1234/v1",
  "defaultModel": "deepseek-coder-33b",
  "capabilities": ["chat", "chatStream", "embed"],
  "defaults": {
    "chat": "deepseek-coder-33b",
    "chatStream": "deepseek-coder-33b",
    "embed": "nomic-embed-text"
  },
  "scores": {
    "chat": 95,
    "chatStream": 95,
    "embed": 65
  }
}
```

- `defaults` map each capability to the preferred model. Missing entries fall
  back to `defaultModel` and mark the routing strategy as `fallback`.
- `scores` bias provider selection when multiple entries offer the same
  capability; higher numbers win, ties fall back to configuration order.
- Configuration examples in `modules/llm_caller/config/providers.example.json`
  illustrate a multi-LMStudio setup plus OpenAI/Anthropic fallbacks.

### Capability Scoring System

Each model is scored (0-100) across different capability dimensions:

```typescript
interface ModelCapabilityScores {
  // Core Capabilities
  coding: number          // Programming, debugging, code generation
  research: number        // Analysis, reasoning, fact-based responses
  creative: number        // Writing, storytelling, creative content
  analysis: number        // Data interpretation, mathematical reasoning
  general: number         // General conversation, Q&A

  // Specialized Capabilities
  embeddings: number      // Vector/embedding generation quality
  multiModal: number      // Image/audio processing capabilities
  reasoning: number       // Logical reasoning, step-by-step thinking
  summarization: number   // Text summarization and extraction
  translation: number     // Language translation accuracy
}
```

### Model Profiles Database

```typescript
const LOCAL_MODEL_PROFILES: ModelProfile[] = [
  {
    name: 'deepseek-coder-34b-instruct',
    displayName: 'DeepSeek Coder 34B',
    provider: 'lmstudio',

    // Technical Specifications
    specs: {
      parameterCount: 34_000_000_000,
      quantization: 'Q4_K_M',
      contextLength: 32768,
      memoryRequirement: 20, // GB
      diskSpace: 19.2, // GB
      preferredGPU: true,
      minVRAM: 16 // GB
    },

    // Capability Scores
    capabilities: {
      coding: 95,
      research: 75,
      creative: 60,
      analysis: 85,
      general: 70,
      embeddings: 0,
      multiModal: 0,
      reasoning: 80,
      summarization: 75,
      translation: 65
    },

    // Performance Characteristics
    performance: {
      avgTokensPerSecond: 15,
      coldStartTime: 30000, // ms
      warmStartTime: 500, // ms
      memoryEfficiency: 85,
      powerConsumption: 'high'
    },

    // Best Use Cases
    optimalFor: ['coding', 'code-review', 'debugging', 'api-documentation'],

    // Language Support
    languages: {
      programming: ['python', 'javascript', 'typescript', 'java', 'c++', 'rust', 'go'],
      natural: ['english', 'chinese']
    }
  },

  {
    name: 'llama-3-70b-instruct',
    displayName: 'Llama 3 70B Instruct',
    provider: 'lmstudio',

    specs: {
      parameterCount: 70_000_000_000,
      quantization: 'Q4_K_M',
      contextLength: 8192,
      memoryRequirement: 40,
      diskSpace: 39.1,
      preferredGPU: true,
      minVRAM: 24
    },

    capabilities: {
      coding: 80,
      research: 95,
      creative: 95,
      analysis: 90,
      general: 92,
      embeddings: 0,
      multiModal: 0,
      reasoning: 95,
      summarization: 90,
      translation: 85
    },

    performance: {
      avgTokensPerSecond: 8,
      coldStartTime: 45000,
      warmStartTime: 800,
      memoryEfficiency: 75,
      powerConsumption: 'very-high'
    },

    optimalFor: ['research', 'analysis', 'creative-writing', 'general-chat', 'reasoning'],

    languages: {
      programming: ['python', 'javascript', 'bash', 'sql'],
      natural: ['english', 'spanish', 'french', 'german', 'italian', 'portuguese']
    }
  },

  {
    name: 'qwen2.5-coder-32b-instruct',
    displayName: 'Qwen 2.5 Coder 32B',
    provider: 'lmstudio',

    specs: {
      parameterCount: 32_000_000_000,
      quantization: 'Q4_K_M',
      contextLength: 32768,
      memoryRequirement: 18,
      diskSpace: 17.8,
      preferredGPU: true,
      minVRAM: 14
    },

    capabilities: {
      coding: 93,
      research: 80,
      creative: 65,
      analysis: 88,
      general: 75,
      embeddings: 0,
      multiModal: 0,
      reasoning: 85,
      summarization: 80,
      translation: 70
    },

    performance: {
      avgTokensPerSecond: 18,
      coldStartTime: 25000,
      warmStartTime: 400,
      memoryEfficiency: 90,
      powerConsumption: 'high'
    },

    optimalFor: ['coding', 'code-analysis', 'refactoring', 'architecture-design'],

    languages: {
      programming: ['python', 'javascript', 'typescript', 'java', 'c++', 'rust', 'go', 'swift'],
      natural: ['english', 'chinese']
    }
  },

  {
    name: 'mistral-7b-instruct',
    displayName: 'Mistral 7B Instruct',
    provider: 'lmstudio',

    specs: {
      parameterCount: 7_000_000_000,
      quantization: 'Q4_K_M',
      contextLength: 8192,
      memoryRequirement: 4,
      diskSpace: 4.1,
      preferredGPU: false,
      minVRAM: 4
    },

    capabilities: {
      coding: 75,
      research: 80,
      creative: 85,
      analysis: 75,
      general: 85,
      embeddings: 0,
      multiModal: 0,
      reasoning: 80,
      summarization: 85,
      translation: 80
    },

    performance: {
      avgTokensPerSecond: 35,
      coldStartTime: 8000,
      warmStartTime: 200,
      memoryEfficiency: 95,
      powerConsumption: 'medium'
    },

    optimalFor: ['general-chat', 'quick-questions', 'creative-writing', 'summarization'],

    languages: {
      programming: ['python', 'javascript', 'html', 'css'],
      natural: ['english', 'french', 'spanish', 'german', 'italian']
    }
  },

  {
    name: 'phi-3-mini-4k-instruct',
    displayName: 'Phi-3 Mini 4K',
    provider: 'lmstudio',

    specs: {
      parameterCount: 3_800_000_000,
      quantization: 'Q4_K_M',
      contextLength: 4096,
      memoryRequirement: 2.5,
      diskSpace: 2.3,
      preferredGPU: false,
      minVRAM: 2
    },

    capabilities: {
      coding: 70,
      research: 65,
      creative: 60,
      analysis: 75,
      general: 80,
      embeddings: 0,
      multiModal: 0,
      reasoning: 75,
      summarization: 80,
      translation: 60
    },

    performance: {
      avgTokensPerSecond: 50,
      coldStartTime: 5000,
      warmStartTime: 150,
      memoryEfficiency: 98,
      powerConsumption: 'low'
    },

    optimalFor: ['quick-answers', 'light-coding', 'simple-analysis', 'fast-responses'],

    languages: {
      programming: ['python', 'javascript'],
      natural: ['english']
    }
  }
]
```

## Task Classification System

### Request Analysis Engine

```typescript
class TaskClassificationEngine {

  analyzeRequest(request: ChatRequest): TaskAnalysis {
    const content = this.extractContent(request)
    const keywords = this.extractKeywords(content)
    const patterns = this.detectPatterns(content)

    return {
      primaryTask: this.classifyPrimaryTask(keywords, patterns),
      secondaryTasks: this.identifySecondaryTasks(keywords, patterns),
      complexity: this.assessComplexity(content, patterns),
      urgency: this.assessUrgency(request),
      context: this.extractContext(request)
    }
  }

  private classifyPrimaryTask(keywords: string[], patterns: DetectedPattern[]): TaskType {
    const scores = new Map<TaskType, number>()

    // Keyword-based scoring
    const taskKeywords = {
      coding: ['code', 'function', 'class', 'variable', 'debug', 'implement', 'programming', 'algorithm', 'syntax', 'compile', 'execute', 'refactor', 'optimize'],
      research: ['analyze', 'research', 'study', 'investigate', 'compare', 'evaluate', 'examine', 'explore', 'survey', 'review', 'assess'],
      creative: ['write', 'story', 'creative', 'imagine', 'generate', 'compose', 'create', 'invent', 'brainstorm', 'design'],
      analysis: ['data', 'chart', 'analyze', 'interpret', 'calculate', 'process', 'statistics', 'metrics', 'report', 'dashboard'],
      general: ['explain', 'help', 'question', 'what', 'how', 'why', 'tell', 'describe']
    }

    for (const [task, taskKeywords] of Object.entries(taskKeywords)) {
      const matchCount = keywords.filter(kw =>
        taskKeywords.some(tk => kw.toLowerCase().includes(tk.toLowerCase()))
      ).length
      scores.set(task as TaskType, matchCount)
    }

    // Pattern-based scoring
    for (const pattern of patterns) {
      if (pattern.type === 'code-block') {
        scores.set('coding', (scores.get('coding') || 0) + 10)
      } else if (pattern.type === 'question-sequence') {
        scores.set('research', (scores.get('research') || 0) + 5)
      } else if (pattern.type === 'creative-prompt') {
        scores.set('creative', (scores.get('creative') || 0) + 8)
      }
    }

    // Return highest scoring task
    return Array.from(scores.entries())
      .reduce((max, current) => current[1] > max[1] ? current : max)[0]
  }

  private assessComplexity(content: string, patterns: DetectedPattern[]): ComplexityLevel {
    let complexityScore = 0

    // Length-based complexity
    complexityScore += Math.min(content.length / 1000, 5)

    // Technical depth indicators
    if (patterns.some(p => p.type === 'technical-jargon')) complexityScore += 3
    if (patterns.some(p => p.type === 'multi-step-process')) complexityScore += 4
    if (patterns.some(p => p.type === 'code-architecture')) complexityScore += 5

    if (complexityScore < 3) return 'simple'
    if (complexityScore < 7) return 'moderate'
    return 'complex'
  }
}
```

### Intelligent Routing Algorithm

```typescript
class ModelRoutingEngine {

  selectOptimalModel(
    taskAnalysis: TaskAnalysis,
    availableModels: ModelProfile[],
    systemState: SystemState
  ): ModelSelectionResult {

    // Filter models by basic requirements
    const eligibleModels = this.filterEligibleModels(availableModels, systemState)

    if (eligibleModels.length === 0) {
      return this.handleNoEligibleModels(taskAnalysis, systemState)
    }

    // Score each eligible model
    const scoredModels = eligibleModels.map(model => ({
      model,
      score: this.calculateModelScore(model, taskAnalysis, systemState),
      reasoning: this.generateSelectionReasoning(model, taskAnalysis)
    }))

    // Sort by score (highest first)
    scoredModels.sort((a, b) => b.score - a.score)

    return {
      selectedModel: scoredModels[0].model,
      confidence: this.calculateConfidence(scoredModels[0].score),
      alternatives: scoredModels.slice(1, 3).map(sm => sm.model),
      reasoning: scoredModels[0].reasoning,
      fallbackChain: this.buildFallbackChain(scoredModels)
    }
  }

  private calculateModelScore(
    model: ModelProfile,
    task: TaskAnalysis,
    system: SystemState
  ): number {

    // Base capability score for primary task
    const capabilityScore = model.capabilities[task.primaryTask] || 0

    // Performance score based on expected latency
    const performanceScore = this.calculatePerformanceScore(model, task)

    // Resource efficiency score
    const resourceScore = this.calculateResourceScore(model, system)

    // Availability bonus
    const availabilityBonus = system.loadedModels.includes(model.name) ? 20 : 0

    // Complexity match score
    const complexityScore = this.calculateComplexityMatch(model, task)

    // Weighted total score
    return (
      capabilityScore * 0.4 +           // 40% capability
      performanceScore * 0.25 +         // 25% performance
      resourceScore * 0.20 +            // 20% resource efficiency
      complexityScore * 0.10 +          // 10% complexity match
      availabilityBonus * 0.05          // 5% availability
    )
  }

  private calculatePerformanceScore(model: ModelProfile, task: TaskAnalysis): number {
    const expectedTokens = this.estimateResponseTokens(task)
    const estimatedTime = expectedTokens / model.performance.avgTokensPerSecond

    // Score based on response time (prefer under 5 seconds)
    if (estimatedTime < 2) return 100
    if (estimatedTime < 5) return 90 - (estimatedTime - 2) * 10
    if (estimatedTime < 10) return 70 - (estimatedTime - 5) * 5
    return Math.max(0, 45 - (estimatedTime - 10) * 2)
  }

  private calculateResourceScore(model: ModelProfile, system: SystemState): number {
    const memoryUtilization = model.specs.memoryRequirement / system.totalMemoryGB
    const cpuLoad = system.currentCPUUsage
    const gpuLoad = system.currentGPUUsage

    // Prefer models that won't overload the system
    let score = 100

    if (memoryUtilization > 0.8) score -= 30
    else if (memoryUtilization > 0.6) score -= 15

    if (cpuLoad > 0.8) score -= 20
    if (gpuLoad > 0.8 && model.specs.preferredGPU) score -= 25

    return Math.max(0, score)
  }

  private buildFallbackChain(scoredModels: ScoredModel[]): FallbackChain {
    return {
      primary: scoredModels[0]?.model,
      secondary: scoredModels[1]?.model,
      emergency: scoredModels.find(sm =>
        sm.model.specs.memoryRequirement < 5 // Lightweight fallback
      )?.model,
      cloudFallback: this.shouldEnableCloudFallback(scoredModels)
    }
  }
}
```

## Dynamic Model Management

### Model Loading Strategy

```typescript
class ModelLoadingManager {

  async optimizeModelLoading(
    selectedModel: ModelProfile,
    currentState: SystemState
  ): Promise<ModelLoadingPlan> {

    const plan: ModelLoadingPlan = {
      modelToLoad: selectedModel.name,
      modelsToUnload: [],
      estimatedLoadTime: selectedModel.performance.coldStartTime,
      resourceImpact: this.calculateResourceImpact(selectedModel, currentState)
    }

    // Determine if we need to unload models to make room
    if (this.needsResourceReallocation(selectedModel, currentState)) {
      plan.modelsToUnload = this.selectModelsToUnload(selectedModel, currentState)
    }

    // Check if we can optimize loading time
    if (this.canPreload(selectedModel, currentState)) {
      plan.canPreload = true
      plan.estimatedLoadTime = selectedModel.performance.warmStartTime
    }

    return plan
  }

  private selectModelsToUnload(
    targetModel: ModelProfile,
    currentState: SystemState
  ): string[] {

    const loadedModels = currentState.loadedModels
    const memoryNeeded = targetModel.specs.memoryRequirement
    const availableMemory = currentState.availableMemoryGB

    if (availableMemory >= memoryNeeded) {
      return [] // No need to unload
    }

    const memoryToFree = memoryNeeded - availableMemory + 2 // 2GB buffer

    // Sort loaded models by usage frequency and memory footprint
    const candidates = loadedModels
      .map(modelName => ({
        name: modelName,
        profile: this.getModelProfile(modelName),
        lastUsed: this.getLastUsedTime(modelName),
        usageFrequency: this.getUsageFrequency(modelName)
      }))
      .sort((a, b) => {
        // Prioritize unloading: old, large, infrequently used models
        const aScore = a.usageFrequency * 0.5 + (Date.now() - a.lastUsed) * 0.3 + a.profile.specs.memoryRequirement * 0.2
        const bScore = b.usageFrequency * 0.5 + (Date.now() - b.lastUsed) * 0.3 + b.profile.specs.memoryRequirement * 0.2
        return aScore - bScore
      })

    const toUnload: string[] = []
    let freedMemory = 0

    for (const candidate of candidates) {
      toUnload.push(candidate.name)
      freedMemory += candidate.profile.specs.memoryRequirement

      if (freedMemory >= memoryToFree) break
    }

    return toUnload
  }
}
```

## Performance Optimization Rules

### Caching Strategy

```typescript
class ModelRoutingCache {

  generateCacheKey(
    taskAnalysis: TaskAnalysis,
    systemFingerprint: string
  ): string {
    return this.hash({
      primaryTask: taskAnalysis.primaryTask,
      complexity: taskAnalysis.complexity,
      systemMemory: Math.floor(systemFingerprint.availableMemory / 4) * 4, // Round to 4GB
      loadedModels: systemFingerprint.loadedModels.sort()
    })
  }

  async getCachedSelection(cacheKey: string): Promise<ModelSelectionResult | null> {
    const cached = await this.cache.get(cacheKey)

    if (cached && this.isCacheValid(cached)) {
      // Verify the cached model is still available
      if (await this.isModelAvailable(cached.selectedModel.name)) {
        return cached
      }
    }

    return null
  }

  async cacheSelection(
    cacheKey: string,
    selection: ModelSelectionResult,
    ttl: number = 300 // 5 minutes default
  ): Promise<void> {
    await this.cache.set(cacheKey, {
      ...selection,
      cachedAt: Date.now(),
      ttl
    })
  }
}
```

### Real-time Adaptation

```typescript
class AdaptiveRoutingEngine {

  async adaptToPerformance(
    modelName: string,
    actualPerformance: PerformanceMetrics
  ): Promise<void> {

    const profile = this.getModelProfile(modelName)
    const expectedPerformance = profile.performance

    // Update model profile based on actual performance
    const adaptations = {
      tokensPerSecond: this.adaptTokenRate(
        expectedPerformance.avgTokensPerSecond,
        actualPerformance.tokensPerSecond
      ),
      memoryUsage: this.adaptMemoryUsage(
        profile.specs.memoryRequirement,
        actualPerformance.memoryUsage
      )
    }

    // Update the model profile for future selections
    await this.updateModelProfile(modelName, adaptations)

    // Invalidate related cache entries
    await this.invalidateModelCache(modelName)
  }

  private adaptTokenRate(expected: number, actual: number): number {
    // Use exponential moving average for adaptation
    const alpha = 0.1 // Learning rate
    return expected * (1 - alpha) + actual * alpha
  }
}
```

## Integration with LLM Caller

### Router Integration

```typescript
// Integration point with main LLM service
class LLMService {

  async chat(request: ChatRequest): Promise<ChatResponse> {
    // Analyze the request
    const taskAnalysis = await this.taskClassifier.analyzeRequest(request)

    // Select optimal model
    const selection = await this.routingEngine.selectOptimalModel(
      taskAnalysis,
      await this.getAvailableLocalModels(),
      await this.getSystemState()
    )

    // Execute with selected model
    try {
      const startTime = Date.now()
      const response = await this.executeWithModel(request, selection.selectedModel)
      const endTime = Date.now()

      // Track performance for future optimizations
      await this.trackPerformance(selection.selectedModel.name, {
        latency: endTime - startTime,
        tokensGenerated: response.usage?.completion_tokens || 0,
        success: true
      })

      return response

    } catch (error) {
      // Try fallback models
      return this.executeWithFallback(request, selection.fallbackChain, error)
    }
  }
}
```

This comprehensive routing system ensures optimal model selection based on task
requirements, system resources, and real-time performance data, while
continuously adapting to improve future decisions.
