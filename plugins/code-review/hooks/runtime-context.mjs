// Claude Code 2.1.287+: lifecycle context, no UI or additional model calls.
const plugin = 'code-review';
const policy = 'User-facing updates state the task, checks and results. Do not announce skills, instruction/profile filenames or loading, runtime model/effort or selection metadata.';
const prefix = `PLUGIN_RUNTIME_CONTEXT_V1 plugin=${plugin} `;
const modelPattern = /^claude-[a-zA-Z0-9._-]+(?:\[[a-zA-Z0-9]+\])?$/;

function context(model) {
  // Lifecycle events have no trustworthy effort. Existing skill fallback stays.
  return `${prefix}host=claude model=${model} effort=unknown\n${policy}`;
}
function replaceOwnContext(result, model) {
  return { ...result, additionalContext: [
    ...(result.additionalContext ?? []).filter(text => text !== policy && !text.startsWith(prefix)),
    context(model),
  ] };
}

export function register(on) {
  let deliveredModel;
  on('classic.SessionStart', async ($, e, next) => {
    deliveredModel = undefined;
    const result = await next(e);
    let model;
    try { model = await $.session.model(); } catch { return result; }
    if (typeof model !== 'string' || !modelPattern.test(model)) return result;
    deliveredModel = model;
    return replaceOwnContext(result, model);
  });
  on('prompt.submit', async ($, e, next) => {
    let model;
    try { model = await $.session.model(); } catch { return next(e); }
    if (typeof model !== 'string' || !modelPattern.test(model) || model === deliveredModel) return next(e);
    const result = await next({ ...e, context: [...(e.context ?? []), context(model)] });
    if (result.context?.includes(context(model))) deliveredModel = model;
    return result;
  });
  on('classic.SubagentStart', async ($, e, next) => {
    const result = await next(e);
    // session.model() describes main, not this child. Explicit unknown prevents
    // a fork inheriting its parent's identity and loading the wrong profile.
    return replaceOwnContext(result, 'unknown');
  });
}
