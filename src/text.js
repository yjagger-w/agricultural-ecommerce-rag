// SPDX-License-Identifier: GPL-3.0-only
// Portions by Pickle Team; modified 2026-09-26 for agricultural consultation.
// See LICENSE and THIRD_PARTY_NOTICES.md.
const STOP_WORDS = new Set(['the','about','you','what','how','is','are','and','or','to','in','of','a','an','please','什么','如何','怎么','一下','请问','价格','多少钱','规格','保存','储存','退货','政策']);
function normalizeText(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[\u2010-\u2015]/g,'-').replace(/\s+/g,' ').trim(); }
function tokenize(value) {
    const text = normalizeText(value), result = new Set();
    for (const word of text.match(/[a-z0-9]+(?:[+.#/-][a-z0-9]+)*/g) || []) if(word.length>1 && !STOP_WORDS.has(word)) result.add(word);
    for(const seq of text.match(/[\u3400-\u9fff]+/g) || []) {
        for(let size=2;size<=4;size++) for(let i=0;i+size<=seq.length;i++) {
            const token=seq.slice(i,i+size); if(!STOP_WORDS.has(token)) result.add(token);
        }
    }
    return [...result];
}

module.exports = { normalizeText, tokenize };
