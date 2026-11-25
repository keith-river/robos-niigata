/* ステークホルダーの役割カード（UMD）
 * 実在の個人・団体・企業ではなく、立場の典型として作った架空の役割です。
 * expert = 得意な課題（ISSUES の番号）。その課題の石に立つと「ホーム」になり、手札が1枚増えます。
 * signature = 役割が最初から持つ道具（tools.js の id）。cares/worries は審査員が「心に響く説明」かを見るときの手がかり。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ROLES = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ROLES = [
    { id: 'pref', name: '県の政策担当', icon: '🏛️', color: '#4d8bff',
      skill: '予算・制度設計、部局間の調整', duty: '県全体の方針と財源をまとめ、前例のない試行を庁内で通す',
      cares: ['公平性', '説明責任', '予算の根拠', '前例'], worries: ['前例がない', '縦割り', '議会への説明'],
      expert: [1, 12, 11, 14], signature: ['logic-model', 'stakeholder-map'] },
    { id: 'town', name: '市町村の現場職員', icon: '🏘️', color: '#2ec4b6',
      skill: '住民との対話、地域資源の把握', duty: '住民の声を拾い、小さく試して現場で回す',
      cares: ['住民', '現場の負担', '地域の事情', '人手'], worries: ['人手が足りない', '住民の合意', '担当が1人'],
      expert: [3, 4, 0, 11], signature: ['implementation-intention', 'easy'] },
    { id: 'univ', name: '大学の研究者', icon: '🎓', color: '#a06bff',
      skill: 'データ分析、実証・評価の設計', duty: '効果を測れる形にし、根拠を積み上げる',
      cares: ['根拠', '再現性', '測定', '学生'], worries: ['データがない', '因果が不明', '評価できない'],
      expert: [13, 14, 2, 16], signature: ['lean-mvp', 'kpi-tree'] },
    { id: 'gnt', name: '県内ものづくり企業（GNT）の経営者', icon: '🏭', color: '#ff8a3d',
      skill: '技術・採用・事業化、海外販路', duty: '強みを伸ばし、地域に雇用と賃金を生む',
      cares: ['採用', '賃金', '技術', '事業の採算'], worries: ['採算が合わない', '人が採れない', '規制'],
      expert: [15, 16, 6, 2], signature: ['unit-economics', 'rpv'] },
    { id: 'farm', name: '農業法人の代表', icon: '🌾', color: '#7bc043',
      skill: '営農計画、作業の効率化、販売', duty: '田んぼと担い手を守り、所得を安定させる',
      cares: ['田んぼ', '担い手', '所得', '季節'], worries: ['作業が増える', '米価', '高齢化'],
      expert: [5, 6, 9, 10], signature: ['default', 'loss-aversion'] },
    { id: 'npo', name: '地域づくりNPOの代表', icon: '🤝', color: '#ff7eb6',
      skill: 'コミュニティづくり、ボランティアの巻き込み', duty: '人と人をつなぎ、最初の一歩の場をつくる',
      cares: ['つながり', '居場所', '参加のしやすさ', '共助'], worries: ['担い手の疲れ', '資金が続かない', '参加者が増えない'],
      expert: [7, 3, 17, 0], signature: ['social-norm', 'foot-in-the-door'] },
    { id: 'bank', name: '地域金融機関の担当者', icon: '🏦', color: '#ffb703',
      skill: '事業評価、資金調達の設計、企業ネットワーク', duty: 'お金と企業をつなぎ、返済可能な形にする',
      cares: ['資金', '返済', '事業の継続', 'リスク'], worries: ['回収できない', '赤字が続く', '前例がない'],
      expert: [4, 6, 15, 8], signature: ['business-model-canvas', 'premortem'] },
    { id: 'student', name: '学生・若者', icon: '🧑‍🎓', color: '#ff5a5f',
      skill: '当事者の声、SNSでの発信、柔軟な発想', duty: '当事者の目線で、使われる形かを確かめる',
      cares: ['お金', '時間', '将来の選択肢', '共感'], worries: ['忙しい', '自分ごとに感じない', '責められる'],
      expert: [13, 14, 15, 16, 17], signature: ['jtbd-statement', 'four-forces'] }
  ];
  return { ROLES, byId: (id) => ROLES.find((r) => r.id === id) };
}));
