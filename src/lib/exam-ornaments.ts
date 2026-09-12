// ============================================================
// مكتبة زخارف ورقة الاختبار — متنوعة وكثيرة لكل المواد
// - كل مادة لها طقم افتراضي + مكتبة شاملة يختار منها المعلم
// - تُرسم كأختام (Emoji) خفيفة الشفافية ولا تغطي نص الأسئلة
// ============================================================

export interface OrnamentDef {
  kind: string;
  glyph: string;
  label: string;
}

export interface SubjectCatalog {
  key: string;
  label: string;
  /** كلمات تُطابق اسم المادة (بعد التطبيع) */
  match: string[];
  ornaments: OrnamentDef[];
}

export const SUBJECT_CATALOG: SubjectCatalog[] = [
  {
    key: 'general', label: 'عام', match: ['', 'عام', 'شامل', 'general'],
    ornaments: [
      { kind: 'book', glyph: '📖', label: 'كتاب' },
      { kind: 'pencil', glyph: '✏️', label: 'قلم' },
      { kind: 'pen', glyph: '🖊️', label: 'قلم حبر' },
      { kind: 'star', glyph: '⭐', label: 'نجمة' },
      { kind: 'sparkles', glyph: '✨', label: 'لمعان' },
      { kind: 'trophy', glyph: '🏆', label: 'كأس' },
      { kind: 'grad', glyph: '🎓', label: 'تخرج' },
      { kind: 'books', glyph: '📚', label: 'كتب' },
      { kind: 'notebook', glyph: '📓', label: 'دفتر' },
      { kind: 'bulb', glyph: '💡', label: 'فكرة' },
      { kind: 'award', glyph: '🏅', label: 'ميدالية' },
      { kind: 'rocket', glyph: '🚀', label: 'صاروخ' },
    ],
  },
  {
    key: 'science', label: 'علوم', match: ['علوم', 'science', 'ساينس'],
    ornaments: [
      { kind: 'microscope', glyph: '🔬', label: 'مجهر' },
      { kind: 'flask', glyph: '🧪', label: 'أنبوب' },
      { kind: 'alembic', glyph: '⚗️', label: 'دورق' },
      { kind: 'dna', glyph: '🧬', label: 'حمض نووي' },
      { kind: 'petri', glyph: '🧫', label: 'طبق زراعة' },
      { kind: 'telescope', glyph: '🔭', label: 'تلسكوب' },
      { kind: 'sun', glyph: '☀️', label: 'شمس' },
      { kind: 'moon', glyph: '🌙', label: 'قمر' },
      { kind: 'planet', glyph: '🪐', label: 'كوكب' },
      { kind: 'earth', glyph: '🌍', label: 'أرض' },
      { kind: 'zap', glyph: '⚡', label: 'كهرباء' },
      { kind: 'leaf', glyph: '🌿', label: 'ورقة نبات' },
      { kind: 'magnet', glyph: '🧲', label: 'مغناطيس' },
      { kind: 'drop', glyph: '💧', label: 'قطرة' },
      { kind: 'satellite', glyph: '🛰️', label: 'قمر صناعي' },
    ],
  },
  {
    key: 'chemistry', label: 'كيمياء', match: ['كيمياء', 'chemistry', 'كيمي'],
    ornaments: [
      { kind: 'flask', glyph: '🧪', label: 'أنبوب' },
      { kind: 'alembic', glyph: '⚗️', label: 'دورق' },
      { kind: 'petri', glyph: '🧫', label: 'طبق زراعة' },
      { kind: 'dna', glyph: '🧬', label: 'حمض نووي' },
      { kind: 'atom', glyph: '⚛️', label: 'ذرة' },
      { kind: 'fire', glyph: '🔥', label: 'لهب' },
      { kind: 'drop', glyph: '💧', label: 'قطرة' },
      { kind: 'bubbles', glyph: '🫧', label: 'فقاعات' },
      { kind: 'magnet', glyph: '🧲', label: 'مغناطيس' },
      { kind: 'ice', glyph: '🧊', label: 'ثلج' },
      { kind: 'boom', glyph: '💥', label: 'تفاعل' },
      { kind: 'extinguish', glyph: '🧯', label: 'إطفاء' },
      { kind: 'battery', glyph: '🔋', label: 'بطارية' },
      { kind: 'scale', glyph: '⚖️', label: 'ميزان' },
    ],
  },
  {
    key: 'physics', label: 'فيزياء', match: ['فيزياء', 'physics', 'فيزي'],
    ornaments: [
      { kind: 'atom', glyph: '⚛️', label: 'ذرة' },
      { kind: 'telescope', glyph: '🔭', label: 'تلسكوب' },
      { kind: 'magnet', glyph: '🧲', label: 'مغناطيس' },
      { kind: 'zap', glyph: '⚡', label: 'كهرباء' },
      { kind: 'bulb', glyph: '💡', label: 'فكرة' },
      { kind: 'battery', glyph: '🔋', label: 'بطارية' },
      { kind: 'planet', glyph: '🪐', label: 'كوكب' },
      { kind: 'moon', glyph: '🌙', label: 'قمر' },
      { kind: 'satellite', glyph: '🛰️', label: 'قمر صناعي' },
      { kind: 'galaxy', glyph: '🌌', label: 'مجرة' },
      { kind: 'gear', glyph: '⚙️', label: 'ترس' },
      { kind: 'antenna', glyph: '📡', label: 'هوائي' },
      { kind: 'rocket', glyph: '🚀', label: 'صاروخ' },
      { kind: 'compass', glyph: '🧭', label: 'بوصلة' },
    ],
  },
  {
    key: 'biology', label: 'أحياء', match: ['احياء', 'أحياء', 'biology', 'بايو', 'حياتي'],
    ornaments: [
      { kind: 'dna', glyph: '🧬', label: 'حمض نووي' },
      { kind: 'petri', glyph: '🧫', label: 'طبق زراعة' },
      { kind: 'microbe', glyph: '🦠', label: 'ميكروب' },
      { kind: 'brain', glyph: '🧠', label: 'مخ' },
      { kind: 'heart', glyph: '🫀', label: 'قلب' },
      { kind: 'lung', glyph: '🫁', label: 'رئة' },
      { kind: 'bone', glyph: '🦴', label: 'عظمة' },
      { kind: 'bug', glyph: '🐞', label: 'حشرة' },
      { kind: 'butterfly', glyph: '🦋', label: 'فراشة' },
      { kind: 'seedling', glyph: '🌱', label: 'بذرة' },
      { kind: 'leaf', glyph: '🌿', label: 'ورقة نبات' },
      { kind: 'fish', glyph: '🐟', label: 'سمكة' },
      { kind: 'bird', glyph: '🐦', label: 'طائر' },
      { kind: 'clover', glyph: '🍀', label: 'برسيم' },
    ],
  },
  {
    key: 'math', label: 'رياضيات', match: ['رياضيات', 'رياضه', 'حساب', 'math', 'رياض'],
    ornaments: [
      { kind: 'abacus', glyph: '🧮', label: 'عداد' },
      { kind: 'divide', glyph: '➗', label: 'قسمة' },
      { kind: 'multiply', glyph: '✖️', label: 'ضرب' },
      { kind: 'plus', glyph: '➕', label: 'جمع' },
      { kind: 'minus', glyph: '➖', label: 'طرح' },
      { kind: 'triangular_ruler', glyph: '📐', label: 'مثلث قائم' },
      { kind: 'ruler', glyph: '📏', label: 'مسطرة' },
      { kind: 'numbers', glyph: '🔢', label: 'أرقام' },
      { kind: 'triangle', glyph: '🔺', label: 'مثلث' },
      { kind: 'circle', glyph: '🔵', label: 'دائرة' },
      { kind: 'dice', glyph: '🎲', label: 'نرد' },
      { kind: 'pie', glyph: '🥧', label: 'قطاع دائري' },
      { kind: 'percent', glyph: '💯', label: 'نسبة مئوية' },
      { kind: 'puzzle', glyph: '🧩', label: 'أحجية' },
    ],
  },
  {
    key: 'arabic', label: 'لغة عربية', match: ['عربي', 'لغه عربيه', 'لغة عربية', 'نحو', 'بلاغة', 'أدب', 'ادب', 'مطالعة'],
    ornaments: [
      { kind: 'book', glyph: '📖', label: 'كتاب' },
      { kind: 'pen', glyph: '🖋️', label: 'ريشة' },
      { kind: 'scroll', glyph: '📜', label: 'بردية' },
      { kind: 'mosque', glyph: '🕌', label: 'مسجد' },
      { kind: 'writing', glyph: '✍️', label: 'كتابة' },
      { kind: 'abc', glyph: '🔤', label: 'حروف' },
      { kind: 'speaking', glyph: '🗣️', label: 'إلقاء' },
      { kind: 'books', glyph: '📚', label: 'كتب' },
      { kind: 'amphora', glyph: '🏺', label: 'إبريق' },
      { kind: 'feather', glyph: '🪶', label: 'ريشة كتابة' },
      { kind: 'lamp', glyph: '🏮', label: 'فانوس' },
      { kind: 'sparkles', glyph: '✨', label: 'لمعان' },
    ],
  },
  {
    key: 'languages', label: 'لغات أجنبية', match: ['انجليزي', 'إنجليزي', 'english', 'فرنساوي', 'فرنسي', 'ألماني', 'لغات', 'لغة انج', 'الماني', 'فرنسية'],
    ornaments: [
      { kind: 'abc', glyph: '🔤', label: 'حروف' },
      { kind: 'speaking', glyph: '🗣️', label: 'محادثة' },
      { kind: 'book', glyph: '📖', label: 'كتاب' },
      { kind: 'pencil', glyph: '✏️', label: 'قلم' },
      { kind: 'earth', glyph: '🌍', label: 'عالم' },
      { kind: 'books', glyph: '📚', label: 'كتب' },
      { kind: 'headphones', glyph: '🎧', label: 'استماع' },
      { kind: 'writing', glyph: '✍️', label: 'كتابة' },
      { kind: 'map', glyph: '🗺️', label: 'خريطة' },
      { kind: 'airplane', glyph: '✈️', label: 'سفر' },
      { kind: 'flag', glyph: '🚩', label: 'علم' },
      { kind: 'star', glyph: '⭐', label: 'نجمة' },
    ],
  },
  {
    key: 'social', label: 'دراسات اجتماعية', match: ['دراسات', 'اجتماعيات', 'تاريخ', 'جغرافيا', 'جغرافية', 'خرائط', 'مواد اجتماعية'],
    ornaments: [
      { kind: 'map', glyph: '🗺️', label: 'خريطة' },
      { kind: 'earth', glyph: '🌍', label: 'أرض' },
      { kind: 'columns', glyph: '🏛️', label: 'أعمدة' },
      { kind: 'amphora', glyph: '🏺', label: 'إبريق' },
      { kind: 'urn', glyph: '⚱️', label: 'جرة' },
      { kind: 'camel', glyph: '🐫', label: 'جمل' },
      { kind: 'desert', glyph: '🏜️', label: 'صحراء' },
      { kind: 'volcano', glyph: '🌋', label: 'بركان' },
      { kind: 'moai', glyph: '🗿', label: 'تمثال' },
      { kind: 'scroll', glyph: '📜', label: 'بردية' },
      { kind: 'swords', glyph: '⚔️', label: 'سيوف' },
      { kind: 'shield', glyph: '🛡️', label: 'درع' },
      { kind: 'flag', glyph: '🚩', label: 'علم' },
      { kind: 'pyramid', glyph: '🔺', label: 'هرم' },
    ],
  },
  {
    key: 'religion', label: 'تربية دينية', match: ['دين', 'دينية', 'إسلامية', 'اسلاميه', 'قران', 'قرآن', 'توحيد', 'فقه', 'حديث', 'تفسير'],
    ornaments: [
      { kind: 'mosque', glyph: '🕌', label: 'مسجد' },
      { kind: 'kaaba', glyph: '🕋', label: 'كعبة' },
      { kind: 'beads', glyph: '📿', label: 'مسبحة' },
      { kind: 'crescent', glyph: '☪️', label: 'هلال' },
      { kind: 'moon', glyph: '🌙', label: 'قمر' },
      { kind: 'star', glyph: '⭐', label: 'نجمة' },
      { kind: 'dove', glyph: '🕊️', label: 'حمامة' },
      { kind: 'book', glyph: '📖', label: 'كتاب' },
      { kind: 'scroll', glyph: '📜', label: 'صحيفة' },
      { kind: 'columns', glyph: '🏛️', label: 'أعمدة' },
      { kind: 'lamp', glyph: '🏮', label: 'فانوس' },
      { kind: 'pray', glyph: '🤲', label: 'دعاء' },
    ],
  },
  {
    key: 'computer', label: 'حاسب آلي', match: ['حاسب', 'كمبيوتر', 'computer', 'برمجة', 'تكنولوجيا', 'تقنية', 'روبوت', 'انترنت', 'إنترنت'],
    ornaments: [
      { kind: 'laptop', glyph: '💻', label: 'حاسوب' },
      { kind: 'desktop', glyph: '🖥️', label: 'شاشة' },
      { kind: 'keyboard', glyph: '⌨️', label: 'لوحة مفاتيح' },
      { kind: 'mouse', glyph: '🖱️', label: 'فأرة' },
      { kind: 'phone', glyph: '📱', label: 'هاتف' },
      { kind: 'disk', glyph: '💾', label: 'قرص' },
      { kind: 'plug', glyph: '🔌', label: 'قابس' },
      { kind: 'robot', glyph: '🤖', label: 'روبوت' },
      { kind: 'puzzle', glyph: '🧩', label: 'أحجية' },
      { kind: 'antenna', glyph: '📡', label: 'هوائي' },
      { kind: 'tools', glyph: '🛠️', label: 'أدوات' },
      { kind: 'gear', glyph: '⚙️', label: 'ترس' },
      { kind: 'satellite', glyph: '🛰️', label: 'قمر صناعي' },
    ],
  },
  {
    key: 'art', label: 'فنون وموسيقى', match: ['رسم', 'فن', 'موسيقى', 'موسيقي', 'تربية فنية', 'فنية', 'مسرح', 'art', 'music'],
    ornaments: [
      { kind: 'palette', glyph: '🎨', label: 'لوحة ألوان' },
      { kind: 'brush', glyph: '🖌️', label: 'فرشاة' },
      { kind: 'masks', glyph: '🎭', label: 'مسرح' },
      { kind: 'notes', glyph: '🎼', label: 'نوتة' },
      { kind: 'music', glyph: '🎵', label: 'موسيقى' },
      { kind: 'guitar', glyph: '🎸', label: 'جيتار' },
      { kind: 'piano', glyph: '🎹', label: 'بيانو' },
      { kind: 'trumpet', glyph: '🎺', label: 'بوق' },
      { kind: 'drum', glyph: '🥁', label: 'طبل' },
      { kind: 'film', glyph: '🎬', label: 'سينما' },
      { kind: 'frame', glyph: '🖼️', label: 'لوحة' },
      { kind: 'mic', glyph: '🎤', label: 'ميكروفون' },
    ],
  },
  {
    key: 'sport', label: 'تربية رياضية', match: ['رياضة', 'تربية رياضية', 'بدنية', 'sport', 'ألعاب'],
    ornaments: [
      { kind: 'football', glyph: '⚽', label: 'كرة قدم' },
      { kind: 'basketball', glyph: '🏀', label: 'سلة' },
      { kind: 'volleyball', glyph: '🏐', label: 'طائرة' },
      { kind: 'tennis', glyph: '🎾', label: 'تنس' },
      { kind: 'pingpong', glyph: '🏓', label: 'تنس طاولة' },
      { kind: 'badminton', glyph: '🏸', label: 'ريشة' },
      { kind: 'swim', glyph: '🏊', label: 'سباحة' },
      { kind: 'run', glyph: '🏃', label: 'جري' },
      { kind: 'gym', glyph: '🤸', label: 'جمباز' },
      { kind: 'medal', glyph: '🥇', label: 'ذهب' },
      { kind: 'trophy', glyph: '🏆', label: 'كأس' },
      { kind: 'bike', glyph: '🚴', label: 'دراجة' },
    ],
  },
];

/** كل الزخارف (بلا تكرار) — المكتبة الشاملة للاختيار الحر */
export const ALL_ORNAMENTS: OrnamentDef[] = (() => {
  const map = new Map<string, OrnamentDef>();
  for (const s of SUBJECT_CATALOG) for (const o of s.ornaments) if (!map.has(o.kind)) map.set(o.kind, o);
  return Array.from(map.values());
})();

export function ornamentDef(kind: string): OrnamentDef | undefined {
  return ALL_ORNAMENTS.find((o) => o.kind === kind);
}

export function ornamentGlyph(kind: string): string {
  return ornamentDef(kind)?.glyph ?? '✦';
}

/** تطبيع اسم المادة للمطابقة */
function normalizeSubject(s: string): string {
  return (s ?? '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** طقم الزخارف المناسب للمادة (يقع على «عام» إن لم يُتعرّف عليها) */
export function ornamentsForSubject(subject: string): OrnamentDef[] {
  const n = normalizeSubject(subject);
  for (const s of SUBJECT_CATALOG) {
    if (s.match.some((m) => normalizeSubject(m) !== '' && n.includes(normalizeSubject(m)))) return s.ornaments;
  }
  return SUBJECT_CATALOG[0].ornaments;
}

/** فهرس مادة حسب اسمها (للعرض) */
export function subjectLabelFor(subject: string): string {
  const n = normalizeSubject(subject);
  for (const s of SUBJECT_CATALOG) {
    if (s.match.some((m) => normalizeSubject(m) !== '' && n.includes(normalizeSubject(m)))) return s.label;
  }
  return SUBJECT_CATALOG[0].label;
}
