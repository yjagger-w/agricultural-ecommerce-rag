// SPDX-License-Identifier: GPL-3.0-only
// Portions by Pickle Team; modified 2026-09-26 for agricultural consultation.
// See LICENSE and THIRD_PARTY_NOTICES.md.
function buildSystemPrompt(promptParts, customPrompt = '', googleSearchEnabled = true) {
    const sections = [promptParts.intro, '\n\n', promptParts.formatRequirements];

    if (googleSearchEnabled) {
        sections.push('\n\n', promptParts.searchUsage);
    }

    sections.push('\n\n', promptParts.content, '\n\nUser-provided context\n-----\n', customPrompt, '\n-----\n\n', promptParts.outputInstructions);

    return sections.join('');
}

module.exports = { buildSystemPrompt };
