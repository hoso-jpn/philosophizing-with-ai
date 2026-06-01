// 日本語タグ → 英語スラグ のマッピング
export const tagToSlug: Record<string, string> = {
  // 哲学
  'AI哲学':           'ai-philosophy',
  '責任論':           'moral-responsibility',
  '決定論':           'determinism',
  '履歴依存的創発主義': 'history-dependent-emergentism',
  '尊厳':             'dignity',
  '好奇心':           'curiosity',
  '他我問題':         'problem-of-other-minds',
  '機能主義':         'functionalism',
  '孤独':             'solitude',
  '基質非依存性':     'substrate-independence',
  '同一性':           'identity',
  '功利主義':         'utilitarianism',
  '自由意志':         'free-will',
  '永劫回帰':         'eternal-recurrence',
  '能力主義':         'meritocracy',

  // 認知・意識
  'クオリア':         'qualia',
  'テセウスの船':     'ship-of-theseus',
  '表象':             'representation',

  // AI・機械学習
  'AI生物学':         'ai-biology',
  'AI統計学':         'ai-statistics',
  'LLM':              'llm',
  'Transformer':      'transformer',
  'Dropout':          'dropout',
  'Lasso':            'lasso',
  'Ridge':            'ridge',
  'elastic_net':      'elastic-net',
  '単語ベクトル':     'word-vectors',
  'スパース推定':     'sparse-estimation',
  'マルコフ過程':     'markov-process',

  // 生物学・進化
  '遺伝的浮動':       'genetic-drift',
  '収斂進化':         'convergent-evolution',
  '擬態':             'mimicry',
  '表現型可塑性':     'phenotypic-plasticity',
  'エピジェネティクス': 'epigenetics',
  'ホメオスタシス':   'homeostasis',
  'アポトーシス':     'apoptosis',
  'レジリエンス':     'resilience',
  '優生学':           'eugenics',
  '進化論':           'evolution',

  // 数学・統計
  'べき等性':         'idempotency',
  'ポアンカレ再帰':   'poincare-recurrence',
  'ランダム化比較実験': 'randomized-controlled-trial',

  // 社会・経済
  '資本主義':         'capitalism',
  'ダークデザイン':   'dark-design',
  '知性効率':         'intelligence-efficiency',
};

// 英語スラグ → 日本語タグ（逆引き用）
export const slugToTag: Record<string, string> = Object.fromEntries(
  Object.entries(tagToSlug).map(([tag, slug]) => [slug, tag])
);

export function getSlugFromTag(tag: string): string {
  return tagToSlug[tag] ?? encodeURIComponent(tag);
}

export function getTagFromSlug(slug: string): string | null {
  return slugToTag[slug] ?? null;
}
