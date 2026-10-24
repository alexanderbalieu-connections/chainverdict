// Deterministic HS (Harmonized System) code triage classifier.
//
// IMPORTANT SCOPE: this is a *lexical* classifier over a curated, bundled
// subset of HS-2022 headings. It is decision-support triage, NOT a customs
// ruling. It returns ranked candidate headings with the official heading text
// so a licensed customs broker (or the agent's human) can confirm. No LLM in
// the serving path — same word in → same ranking out.
//
// The value vs. an LLM: an LLM will confidently invent a 6-digit code that
// looks plausible and is often wrong. This returns only real headings from the
// bundled set, scored transparently, and says so when confidence is low.

// Curated heading set: [heading4, title, keywords[]]. Covers common commerce
// categories. Deliberately bounded and honest about coverage.
const HEADINGS = [
  ['0901', 'Coffee, whether or not roasted or decaffeinated; coffee husks and skins', ['coffee', 'espresso', 'roasted coffee', 'coffee beans', 'decaf']],
  ['0902', 'Tea, whether or not flavoured', ['tea', 'green tea', 'black tea', 'herbal tea']],
  ['1806', 'Chocolate and other food preparations containing cocoa', ['chocolate', 'cocoa', 'candy bar', 'confectionery chocolate']],
  ['1905', 'Bread, pastry, cakes, biscuits and other bakers wares', ['bread', 'biscuit', 'cookie', 'cake', 'pastry', 'wafer', 'crackers']],
  ['2009', 'Fruit and vegetable juices, unfermented', ['juice', 'orange juice', 'apple juice', 'fruit juice']],
  ['2202', 'Waters, incl. mineral and aerated, with added sugar or flavour; other non-alcoholic beverages', ['soda', 'soft drink', 'energy drink', 'flavoured water', 'cola', 'non-alcoholic beverage']],
  ['2203', 'Beer made from malt', ['beer', 'lager', 'ale', 'malt beverage']],
  ['2204', 'Wine of fresh grapes', ['wine', 'red wine', 'white wine', 'sparkling wine', 'champagne']],
  ['3304', 'Beauty or make-up preparations and preparations for the care of the skin', ['cosmetics', 'makeup', 'skincare', 'moisturizer', 'lipstick', 'sunscreen', 'lotion cosmetic']],
  ['3305', 'Preparations for use on the hair', ['shampoo', 'conditioner', 'hair gel', 'hair care']],
  ['3401', 'Soap; organic surface-active products for use as soap', ['soap', 'bar soap', 'hand soap']],
  ['3923', 'Articles for the conveyance or packing of goods, of plastics', ['plastic packaging', 'plastic bottle', 'plastic container', 'plastic bag', 'plastic box']],
  ['3926', 'Other articles of plastics', ['plastic article', 'plastic part', 'plastic accessory', 'plastic item']],
  ['4202', 'Trunks, suitcases, handbags, wallets and similar containers', ['suitcase', 'handbag', 'backpack', 'wallet', 'luggage', 'purse', 'travel bag']],
  ['4901', 'Printed books, brochures, leaflets and similar printed matter', ['book', 'printed book', 'brochure', 'textbook']],
  ['6109', 'T-shirts, singlets and other vests, knitted or crocheted', ['t-shirt', 'tshirt', 'tee shirt', 'tank top', 'vest knitted']],
  ['6110', 'Jerseys, pullovers, cardigans, waistcoats, knitted or crocheted', ['sweater', 'pullover', 'hoodie', 'cardigan', 'jumper', 'jersey knitted']],
  ['6203', 'Men suits, jackets, trousers and shorts (not knitted)', ['trousers', 'mens suit', 'jacket woven', 'shorts woven', 'pants mens']],
  ['6204', 'Women suits, dresses, skirts, trousers (not knitted)', ['dress', 'skirt', 'womens suit', 'blouse woven', 'womens trousers']],
  ['6403', 'Footwear with outer soles of rubber/plastics and uppers of leather', ['shoes leather', 'leather boots', 'leather footwear', 'dress shoes']],
  ['6404', 'Footwear with outer soles of rubber/plastics and textile uppers', ['sneakers', 'trainers', 'canvas shoes', 'sports shoes', 'running shoes']],
  ['7013', 'Glassware for table, kitchen, toilet, office, indoor decoration', ['glassware', 'drinking glass', 'glass cup', 'glass vase', 'glass bowl']],
  ['8471', 'Automatic data-processing machines (computers) and units thereof', ['laptop', 'computer', 'server', 'desktop computer', 'notebook computer', 'ssd', 'hard drive', 'keyboard computer']],
  ['8517', 'Telephone sets, incl. smartphones, and other apparatus for communication', ['smartphone', 'mobile phone', 'cell phone', 'telephone', 'router', 'modem', 'network switch']],
  ['8518', 'Microphones, loudspeakers, headphones, amplifiers', ['headphones', 'earbuds', 'speaker', 'microphone', 'earphones', 'amplifier']],
  ['8523', 'Discs, tapes, solid-state storage devices for recording', ['usb drive', 'memory card', 'sd card', 'flash drive', 'blank disc']],
  ['8528', 'Monitors and projectors; reception apparatus for television', ['monitor', 'tv', 'television', 'projector', 'display screen']],
  ['8544', 'Insulated wire, cable and other insulated electric conductors', ['cable', 'usb cable', 'charging cable', 'wire insulated', 'power cord']],
  ['9002', 'Lenses, prisms, mirrors mounted, being parts of instruments', ['camera lens', 'mounted lens', 'optical lens']],
  ['9013', 'Liquid crystal devices; lasers; other optical appliances', ['laser', 'lcd device', 'optical appliance']],
  ['9401', 'Seats (other than dental/medical), whether or not convertible into beds', ['chair', 'seat', 'sofa', 'office chair', 'stool', 'bench seat']],
  ['9403', 'Other furniture and parts thereof', ['furniture', 'table', 'desk', 'cabinet', 'shelf', 'wardrobe', 'bookcase']],
  ['9503', 'Tricycles, scooters, dolls, toys, puzzles', ['toy', 'doll', 'puzzle', 'toys', 'action figure', 'board game', 'building blocks']],
  ['9504', 'Video game consoles and machines, table or parlour games', ['video game console', 'game console', 'playing cards', 'gaming console', 'arcade machine']],
  ['9506', 'Articles for gymnastics, athletics, sports, outdoor games', ['sports equipment', 'yoga mat', 'dumbbell', 'tennis racket', 'football', 'exercise equipment']],
];

// Precompute a token set per heading.
const NORM = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const INDEX = HEADINGS.map(([code, title, keywords]) => ({
  code,
  title,
  keywords,
  tokens: new Set([...NORM(title), ...keywords.flatMap(NORM)]),
  phrases: keywords.map((k) => k.toLowerCase()),
}));

export function classifyHs(query, limit = 5) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return { query, candidates: [], note: 'empty query' };
  const qTokens = NORM(q);
  const scored = INDEX.map((h) => {
    let score = 0;
    // Strong signal: a full keyword phrase appears in the query.
    for (const p of h.phrases) if (q.includes(p)) score += 5 + p.split(' ').length;
    // Token overlap.
    for (const t of qTokens) if (h.tokens.has(t)) score += 1;
    return { code: h.code, title: h.title, score };
  }).filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const top = scored[0]?.score ?? 0;
  const confidence = top >= 6 ? 'high' : top >= 3 ? 'medium' : top > 0 ? 'low' : 'none';

  return {
    query,
    candidates: scored.map((s) => ({
      hsHeading: s.code,
      chapter: s.code.slice(0, 2),
      officialHeadingText: s.title,
      relativeScore: s.score,
    })),
    confidence,
    coverage:
      'Curated subset of common HS-2022 headings. Absence of a candidate does NOT mean the goods are unclassifiable — it means this bundled set does not cover them.',
    griNote:
      'Ranking is lexical only. Legal classification follows the General Rules of Interpretation (GRI 1–6), Section/Chapter Notes, and the 6-digit subheading, which this triage does not resolve.',
    disclaimer:
      'Informational triage, not a customs ruling or legal advice. Confirm the final code with a licensed customs broker before filing.',
  };
}
