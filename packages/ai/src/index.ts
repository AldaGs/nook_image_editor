// Public API of @nook/ai: the on/off switch, the model loader and the AI tools.
export { aiEnabled, setAiEnabled, onAiChange, AiDisabledError } from './switch.ts';
export { loadModel, removeAiData, storedAiData, modelInstalled, MODELS, AI_CACHE, type ModelId } from './models.ts';
export { removeBackground, unloadSessions } from './background.ts';
export { backgroundModel, setBackgroundModel } from './prefs.ts';
