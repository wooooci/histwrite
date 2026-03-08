export type FinalCheckSeverity = "error" | "warn" | "info";
export type ReferenceSection = "primary" | "secondary";
export type HistoryStudyCategory =
  | "cn-book"
  | "cn-chapter"
  | "cn-journal"
  | "cn-newspaper"
  | "cn-thesis"
  | "cn-conference"
  | "cn-archive"
  | "cn-electronic"
  | "cn-turn-cited"
  | "cn-ancient"
  | "en-book"
  | "en-journal"
  | "en-chapter"
  | "en-archive"
  | "en-thesis"
  | "en-newspaper"
  | "en-document"
  | "en-serial"
  | "en-photo"
  | "unknown";

export type FinalCheckRisk = {
  severity: FinalCheckSeverity;
  code: string;
  message: string;
  line?: number;
  footnoteId?: string;
  referenceId?: string;
};

export type FinalCheckUsageLocation = {
  line: number;
  snippet: string;
};

export type FinalCheckReferenceMatch = {
  referenceId: string;
  section: ReferenceSection;
  line: number;
  raw: string;
  score: number;
};

export type FinalCheckStyleSummary = {
  kind: string;
  notes: string[];
};

export type FinalCheckHistoryStudyStyle = {
  category: HistoryStudyCategory;
  pass: boolean;
  issues: string[];
  basis: string[];
};

export type FinalCheckFootnote = {
  id: string;
  defined: boolean;
  definition?: string;
  definitionLine?: number;
  useCount: number;
  usage: FinalCheckUsageLocation[];
  matches: FinalCheckReferenceMatch[];
  style: FinalCheckStyleSummary;
  historyStudy: FinalCheckHistoryStudyStyle;
  flags: string[];
};

export type FinalCheckReferenceEntry = {
  id: string;
  section: ReferenceSection;
  heading: string;
  line: number;
  raw: string;
  matchedFootnotes: string[];
  style: FinalCheckStyleSummary;
  historyStudy: FinalCheckHistoryStudyStyle;
};

export type FinalCheckFormatProfile = {
  kind: string;
  count: number;
  examples: string[];
};

export type FinalCheckReport = {
  version: 1;
  filePath: string;
  generatedAt: string;
  summary: {
    usedFootnotes: number;
    definedFootnotes: number;
    missingFootnoteDefinitions: string[];
    unusedDefinedFootnotes: string[];
    primaryReferences: number;
    secondaryReferences: number;
    localPathRisks: number;
    placeholderCount: number;
    historyStudyStyleFailures: number;
    errorCount: number;
    warningCount: number;
  };
  footnotes: {
    usedIds: string[];
    definedIds: string[];
    items: FinalCheckFootnote[];
  };
  references: {
    primary: FinalCheckReferenceEntry[];
    secondary: FinalCheckReferenceEntry[];
  };
  formatProfiles: {
    footnotes: FinalCheckFormatProfile[];
    references: FinalCheckFormatProfile[];
    historyStudyFootnotes: FinalCheckFormatProfile[];
  };
  formatRisks: FinalCheckRisk[];
  actions: string[];
  notes: string[];
};

type ParsedFootnoteDefinition = {
  id: string;
  line: number;
  text: string;
};

type ParsedReferenceEntry = {
  id: string;
  section: ReferenceSection;
  heading: string;
  line: number;
  raw: string;
};

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "over",
  "under",
  "about",
  "through",
  "document",
  "documents",
  "press",
  "journal",
  "review",
  "study",
  "studies",
  "history",
  "historical",
  "research",
  "america",
  "american",
  "university",
  "politics",
  "source",
  "sources",
  "资料",
  "研究",
  "美国",
  "历史",
  "文献",
  "档案",
  "材料",
  "访问日期",
]);

const HISTORY_STUDY_BASIS = [
  "依据《历史研究》引文注释规范进行判定；工具侧只保留规则摘要，不再输出任何本机路径。",
  "《历史研究》采用当页脚注体例；中文文献以中文标点、书名号、出版项与页码顺序为主，外文文献按该语种通行方式处理。",
  "同一文献再次引证时，可按《历史研究》规定简化为“责任者 + 题名 + 页码”，工具对此做宽容识别。",
];

function snippet(line: string, maxChars = 90): string {
  const clean = line.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeMatchText(input: string): string {
  return input
    .replace(/\[\^([^\]]+)\]/g, " ")
    .replace(/[“”"'‘’*`_~]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[()[\]{}.,;:!?，。；：！？/|（）-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractTokens(input: string): string[] {
  const normalized = normalizeMatchText(input);
  if (!normalized) return [];
  const raw = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}-]{1,}/gu) ?? [];
  const tokens = raw
    .map((x) => x.trim())
    .filter((x) => x.length >= 2)
    .filter((x) => !STOPWORDS.has(x));
  return Array.from(new Set(tokens)).slice(0, 40);
}

function scoreMatch(a: string, b: string): number {
  const normA = normalizeMatchText(a);
  const normB = normalizeMatchText(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  if (normA.includes(normB) || normB.includes(normA)) return 0.92;

  const tokensA = new Set(extractTokens(normA));
  const tokensB = new Set(extractTokens(normB));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }
  if (overlap === 0) return 0;
  return overlap / Math.max(tokensA.size, tokensB.size);
}

function countChineseTitles(text: string): number {
  return (text.match(/《[^》]+》/g) ?? []).length;
}

function hasPageLike(text: string): boolean {
  return /第\s*[0-9一二三四五六七八九十百千〇零\-—–－,，]+\s*(页|版|册|张|章)/.test(text) || /pp?\.\s*[0-9\-–—, ]+/i.test(text);
}

function hasChinesePlacePublisher(text: string): boolean {
  return /(?:^|[，,])\s*[^，。；：《》]{1,20}：[^，。；]+(?:出版社|书局|书店|印书馆|文献出版社|大学出版社|中心|Press)/.test(text);
}

function hasChineseYear(text: string): boolean {
  return /\d{4}\s*年/.test(text);
}

function hasFullDate(text: string): boolean {
  return /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(text) || /[A-Z][a-z]+ \d{1,2}, \d{4}/.test(text);
}

function hasEnglishYear(text: string): boolean {
  return /\b(?:17|18|19|20)\d{2}\b/.test(text);
}

function hasLooseEnglishDate(text: string): boolean {
  return hasFullDate(text) || hasEnglishYear(text) || /\bundated\b|\bn\.d\.\b/i.test(text);
}

function hasEnglishInstitution(text: string): boolean {
  return /\b(?:University|College|Institute|School|Department|Center|Centre)\b/i.test(text);
}

function hasEnglishArchiveMarkers(text: string): boolean {
  return /(Box\s*\d+|Folder\s*\d+|Series\b|Files\b|Papers\b|Archives?|Library\b|Record Group|RG\b|Corporate Archives|Presidential Material Project)/i.test(text);
}

function hasEnglishDatabaseMarkers(text: string): boolean {
  return /(Gale Primary Sources|Archives Unbound|Associated Press Collections Online|U\.S\. Declassified Documents Online|Roper Center|Political Extremism and Radicalism|Social Documents Collection|Women[’']s Studies Archive|document\s+[A-Z0-9]+)/i.test(text);
}

function hasEnglishSerialTitle(text: string): boolean {
  return /\b(?:Newsletter|Council Letter|Common Sense|Faith and Freedom|Free Enterprise|Christian Crusade|Free Men Speak|Grass Roots|The Independent American|Individualist)\b/i.test(text);
}

function hasEnglishDocumentType(text: string): boolean {
  return /\b(?:letter|statement|message|report|pamphlet|leaflets?|speech|address|testimony|memorandum|memo|minutes|publicity text|wire story|survey|questions?|translation|proceedings|press releases?|printed matter)\b/i.test(text);
}

function hasEnglishNewspaperTitle(text: string): boolean {
  return /\b(?:Times|Gazette|Tribune|Herald|Chronicle|Press-Gazette|Post|Daily)\b/i.test(text) && !/(Journal of|Newsletter|vol\.|no\.)/i.test(text);
}

function stripIndirectLead(text: string): string {
  return text.replace(/^(参见|详见|见|see also|see|cf\.)\s*/i, "").trim();
}

function classifyCitationStyle(raw: string): FinalCheckStyleSummary {
  const notes: string[] = [];
  const text = String(raw ?? "").trim();
  const hasLocalPath = /(?:\/Users\/|\\Users\\|tropy_mineru|file:\/\/)/.test(text);
  const hasUrl = /https?:\/\//i.test(text);
  const hasAccessDate = /访问日期|access(ed)?\s+date|引用日期/i.test(text);
  const hasArchive = /(box|folder|collection|record group|archives?|library|papers|rg\b|馆藏|档案|卷宗号|藏。?$|藏$)/i.test(text);
  const hasDb = /(archives unbound|gale|proquest|jstor|cnki|roper|database|document\s+[A-Z0-9]+)/i.test(text);
  const hasJournalish = /(journal|review|newsletter|gazette|times|wire service|associated press|vol\.|no\.|issue|第\d+期|日报|报)/i.test(text);
  const hasBookish = /(press,\s*\d{4}|university press|出版社|书局|书店|出版)/i.test(text);

  if (hasLocalPath) notes.push("包含本地路径");
  if (hasUrl) notes.push("包含 URL");
  if (hasAccessDate) notes.push("包含访问/引用日期");
  if (hasArchive) notes.push("包含档案定位信息");
  if (hasDb) notes.push("包含数据库/馆藏平台信息");

  let kind = "plain";
  if (hasLocalPath) kind = "local-path";
  else if (hasArchive && hasDb) kind = "archive-db";
  else if (hasArchive) kind = "archive";
  else if (hasDb) kind = "database";
  else if (hasJournalish) kind = "periodical";
  else if (hasBookish) kind = "bookish";

  return { kind, notes };
}

function classifyHistoryStudyCategory(text: string): HistoryStudyCategory {
  const clean = stripIndirectLead(text);
  const titleCount = countChineseTitles(clean);
  const hasEnglishQuote = /[“"][^”"]+[”"]/.test(clean);

  if (/转引自/.test(clean)) return "cn-turn-cited";
  if (/(博士|硕士)学位论文/.test(clean)) return "cn-thesis";
  if (/\b(?:PhD diss\.?|Ph\.D\. dissertation|doctoral dissertation|master'?s thesis|MA thesis|M\.A\. thesis)\b/i.test(clean)) return "en-thesis";
  if (/会议论文|研讨会论文|论坛论文/.test(clean)) return "cn-conference";
  if (/https?:\/\//i.test(clean)) return "cn-electronic";
  if (/\bin\b.+eds?\./i.test(clean) || /\.\s+In\s+[A-Z]/.test(clean)) return "en-chapter";
  if (hasEnglishArchiveMarkers(clean) && /[A-Za-z]/.test(clean) && !/[《》]/.test(clean)) return "en-archive";
  if (
    (hasEnglishQuote && (/vol\./i.test(clean) || (/\bno\./i.test(clean) && /\b(?:Journal|Review|Quarterly|Affairs|Studies|History|China)\b/i.test(clean))))
    || /\.\s+[A-Z][A-Za-z'’& .:-]+\s+\d{1,3},\s*no\.\s*\d+/i.test(clean)
  ) return "en-journal";
  if (hasEnglishNewspaperTitle(clean) && hasFullDate(clean)) return "en-newspaper";
  if (/\bphotograph\b/i.test(clean)) return "en-photo";
  if ((hasEnglishSerialTitle(clean) || (hasEnglishDatabaseMarkers(clean) && /[A-Za-z]/.test(clean) && !hasEnglishDocumentType(clean) && !hasEnglishQuote && !/\b(?:White House|Roper Center|NORC|Associated Press)\b/i.test(clean))) && hasLooseEnglishDate(clean)) {
    return "en-serial";
  }
  if (
    /[A-Za-z]/.test(clean)
    && hasLooseEnglishDate(clean)
    && (
      hasEnglishDocumentType(clean)
      || hasEnglishQuote
      || /\b(?:White House|Roper Center|NORC|Associated Press)\b/i.test(clean)
    )
  ) {
    return "en-document";
  }
  if (/[A-Za-z].+:\s*[^,]+,\s*\d{4}/.test(clean)) return "en-book";
  if (/(馆藏|档案|卷宗号|藏。?$|藏$)/.test(clean)) return "cn-archive";
  if (/《[^》]+》[，,]《[^》]+》.*\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(clean) || /日报|报》/.test(clean) && hasFullDate(clean)) {
    return "cn-newspaper";
  }
  if (/《[^》]+》.*\d{4}\s*年\s*第\s*\d+\s*期/.test(clean) || /《[^》]+》[，,]《[^》]+》.*第\s*\d+\s*期/.test(clean)) {
    return "cn-journal";
  }
  if (/卷\s*\d+|影印本|整理本|点校本|地方志|《[^》]+》卷\s*\d+/.test(clean)) return "cn-ancient";
  if (titleCount >= 2 || /全集第\d+册/.test(clean)) return "cn-chapter";
  if (/^[^：]+：《[^》]+》/.test(clean) || (titleCount >= 1 && (hasChinesePlacePublisher(clean) || hasChineseYear(clean)))) return "cn-book";
  return "unknown";
}

function isSimplifiedRepeatCitation(text: string, category: HistoryStudyCategory, mode: "footnote" | "reference"): boolean {
  if (mode !== "footnote") return false;
  if (!hasPageLike(text)) return false;

  switch (category) {
    case "cn-book":
      return /^[^：]+：《[^》]+》/.test(text) && !hasChinesePlacePublisher(text) && !hasChineseYear(text);
    case "cn-chapter":
      return countChineseTitles(text) >= 2 && !hasChinesePlacePublisher(text) && !hasChineseYear(text);
    case "cn-journal":
      return /^[^：]+：《[^》]+》/.test(text) && !/第\s*\d+\s*期/.test(text) && !hasChineseYear(text);
    case "en-book":
      return /,\s*p{1,2}\./i.test(text) && !/:\s*[^,]+,\s*\d{4}/.test(text);
    case "en-journal":
      return /[“"][^”"]+[”"]/.test(text) && /,\s*p{1,2}\./i.test(text) && !/(vol\.|no\.)/i.test(text);
    case "en-chapter":
      return /[“"][^”"]+[”"]/.test(text) && /,\s*p{1,2}\./i.test(text) && !/\bin\b.+eds?\./i.test(text);
    default:
      return false;
  }
}

function pushMissing(issues: string[], condition: boolean, message: string): void {
  if (!condition) issues.push(message);
}

function analyzeHistoryStudyStyle(raw: string, mode: "footnote" | "reference"): FinalCheckHistoryStudyStyle {
  const text = String(raw ?? "").trim();
  const clean = stripIndirectLead(text);
  const issues: string[] = [];
  const needsPage = mode === "footnote";

  if (!text) {
    return { category: "unknown", pass: false, issues: ["内容为空。"], basis: HISTORY_STUDY_BASIS };
  }

  if (/(?:\/Users\/|\\Users\\|tropy_mineru|file:\/\/)/.test(text)) {
    issues.push("含本地路径，提交前必须改成《历史研究》规范格式。");
  }
  if (text.includes("**###**")) {
    issues.push("仍含占位符 **###**。");
  }

  const category = classifyHistoryStudyCategory(clean);
  const repeated = isSimplifiedRepeatCitation(clean, category, mode);
  const titleCount = countChineseTitles(clean);

  switch (category) {
    case "cn-book": {
      pushMissing(issues, /^[^：]+：《[^》]+》/.test(clean), "中文著作通常应写作“作者：《书名》”。");
      if (!repeated) {
        pushMissing(issues, hasChinesePlacePublisher(clean), "缺少“出版地：出版者”。");
        pushMissing(issues, hasChineseYear(clean), "缺少出版年份（如“1948年”）。");
      }
      if (needsPage) pushMissing(issues, hasPageLike(clean), "脚注应标明具体页码（如“第43页”）。");
      break;
    }
    case "cn-chapter": {
      pushMissing(issues, titleCount >= 2, "析出文献通常需要“析出题名”与“文集题名”两层书名号。");
      if (!repeated) {
        pushMissing(issues, /编|主编|全集|文集|丛书|第\d+册/.test(clean), "析出文献通常需交代文集责任者或文集来源。");
        pushMissing(issues, hasChinesePlacePublisher(clean) || /全集第\d+册/.test(clean), "缺少文集出版地与出版者，或缺少可识别的文集来源。");
        pushMissing(issues, hasChineseYear(clean) || /全集第\d+册/.test(clean), "缺少出版年份。再次引证可省出版信息，但需保留来源信息。");
      }
      if (needsPage) pushMissing(issues, hasPageLike(clean), "析出文献脚注应标明页码。");
      break;
    }
    case "cn-journal": {
      pushMissing(issues, /^[^：]+：《[^》]+》/.test(clean), "期刊文章通常应写作“作者：《文章题名》”。");
      pushMissing(issues, /《[^》]+》/.test(clean), "缺少期刊名书名号。");
      if (!repeated) {
        pushMissing(issues, /\d{4}\s*年/.test(clean), "缺少年份。");
        pushMissing(issues, /第\s*\d+\s*期/.test(clean), "缺少期次（如“2002年第4期”）。");
      }
      break;
    }
    case "cn-newspaper": {
      pushMissing(issues, /《[^》]+》/.test(clean), "报纸引文应交代篇名与报纸名称。");
      pushMissing(issues, hasFullDate(clean), "报纸引文应包含完整年月日。");
      if (needsPage) pushMissing(issues, /第\s*[0-9一二三四五六七八九十百千]+\s*(版|张)/.test(clean), "报纸引文应标明版次。");
      break;
    }
    case "cn-thesis": {
      pushMissing(issues, /^[^：]+：《[^》]+》/.test(clean), "学位论文应写明作者与题名。");
      pushMissing(issues, /(博士|硕士)学位论文/.test(clean), "应明确论文性质（博士/硕士学位论文）。");
      pushMissing(issues, /大学|学院|研究所|系/.test(clean) || hasEnglishInstitution(clean), "应标明授予机构或院系。");
      pushMissing(issues, hasChineseYear(clean), "缺少年份。");
      if (needsPage) pushMissing(issues, hasPageLike(clean), "学位论文脚注应标明页码。");
      break;
    }
    case "cn-conference": {
      pushMissing(issues, /^[^：]+：《[^》]+》/.test(clean), "会议论文应写明作者与题名。");
      pushMissing(issues, /论文/.test(clean), "应注明“会议论文/研讨会论文”等性质。");
      pushMissing(issues, /会议|研讨会|论坛|北京|上海|广州|南京|天津/.test(clean), "应交代会议名称或会议地点。");
      pushMissing(issues, hasChineseYear(clean) || hasFullDate(clean), "缺少形成时间。");
      if (needsPage) pushMissing(issues, hasPageLike(clean), "会议论文脚注应标明页码。");
      break;
    }
    case "cn-archive": {
      pushMissing(issues, /《[^》]+》/.test(clean), "档案文献通常应以《文件标题》起首。");
      pushMissing(issues, hasChineseYear(clean) || hasFullDate(clean), "档案文献应标明形成时间。");
      pushMissing(issues, /(档案|卷宗号|馆藏|藏。?$|藏$)/.test(clean), "缺少卷宗号/编号或藏所信息。");
      break;
    }
    case "cn-turn-cited": {
      pushMissing(issues, /转引自/.test(clean), "转引文献应明确写出“转引自”。");
      pushMissing(issues, countChineseTitles(clean) >= 1 || /[“"][^”"]+[”"]/.test(clean), "转引文献至少应出现原文献或转引文献题名。");
      if (needsPage) pushMissing(issues, hasPageLike(clean), "转引文献脚注应保留原页码或转引页码。");
      break;
    }
    case "cn-electronic": {
      pushMissing(issues, titleCount >= 1 || /[“"][^”"]+[”"]/.test(clean), "电子文献通常应写明题名。");
      pushMissing(issues, /https?:\/\//i.test(clean), "电子文献应包含获取路径。");
      pushMissing(issues, /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(clean), "电子文献应包含更新/引用日期。");
      break;
    }
    case "cn-ancient": {
      pushMissing(issues, titleCount >= 1, "古籍引文应写明书名。");
      pushMissing(issues, /卷\s*\d+|第\s*\d+\s*册/.test(clean), "古籍引文通常应交代卷次/册次。");
      pushMissing(issues, /(本|影印本|整理本|书局|出版社)/.test(clean), "古籍引文通常应标明版本或出版信息。");
      if (needsPage) pushMissing(issues, hasPageLike(clean), "古籍引文应标明页码（必要时注明a/b面或上中下栏）。");
      break;
    }
    case "en-book": {
      if (!repeated) {
        pushMissing(issues, /:\s*[^,]+,\s*\d{4}/.test(clean), "英文专著通常应包含“出版地: 出版者, 年份”。");
      }
      if (needsPage) pushMissing(issues, hasPageLike(clean), "英文专著脚注通常应写 p. / pp. 页码。");
      break;
    }
    case "en-journal": {
      if (!repeated) {
        pushMissing(issues, /(vol\.|no\.)/i.test(clean), "英文期刊文献通常应包含 vol./no. 信息。");
        pushMissing(issues, /\(.*\d{4}.*\)/.test(clean), "英文期刊文献通常应包含年份括注。");
      }
      if (needsPage) pushMissing(issues, hasPageLike(clean), "英文期刊脚注通常应写 p. / pp. 页码。");
      break;
    }
    case "en-chapter": {
      if (!repeated) {
        pushMissing(issues, /\bin\b/i.test(clean), "英文文集析出文献通常应写 in ... ed(s).。");
        pushMissing(issues, /:\s*[^,]+,\s*\d{4}/.test(clean) || /[A-Z][A-Za-z .&'’-]+,\s*\d{4}\./.test(clean), "英文文集析出文献通常应交代出版地、出版者、年份。");
      }
      if (needsPage) pushMissing(issues, hasPageLike(clean), "英文文集析出文献脚注通常应写 p. / pp. 页码。");
      break;
    }
    case "en-archive": {
      pushMissing(issues, hasLooseEnglishDate(clean), "英文档案文献通常应标明形成日期或年代范围。");
      pushMissing(issues, hasEnglishArchiveMarkers(clean), "英文档案文献通常应包含 Box/Folder/Series/藏所。");
      break;
    }
    case "en-thesis": {
      pushMissing(issues, /\b(?:PhD diss\.?|Ph\.D\. dissertation|doctoral dissertation|master'?s thesis|MA thesis|M\.A\. thesis)\b/i.test(clean), "英文/外文学位论文应明确论文性质（PhD diss. / MA thesis 等）。");
      pushMissing(issues, hasEnglishInstitution(clean), "应标明授予机构或院系。");
      pushMissing(issues, hasEnglishYear(clean), "缺少年份。");
      if (needsPage) pushMissing(issues, hasPageLike(clean), "英文/外文学位论文脚注通常应写 p. / pp. 页码。");
      break;
    }
    case "en-newspaper": {
      pushMissing(issues, hasEnglishNewspaperTitle(clean), "英文报纸文献通常应写明报纸名称。");
      pushMissing(issues, hasFullDate(clean), "英文报纸文献通常应标明完整日期。");
      if (needsPage) pushMissing(issues, /\bp{1,2}\.\s*\d+/i.test(clean) || /\bpage\s+\d+/i.test(clean), "英文报纸脚注通常应标明页码/版面。");
      break;
    }
    case "en-document": {
      pushMissing(
        issues,
        hasEnglishDocumentType(clean) || /[“"][^”"]+[”"]/.test(clean) || /\b(?:White House|Roper Center|NORC|Associated Press)\b/i.test(clean),
        "英文文件/讲话/报告类文献通常应写明题名或文类。",
      );
      pushMissing(issues, hasLooseEnglishDate(clean), "英文文件/讲话/报告类文献通常应标明形成日期或年份。");
      pushMissing(
        issues,
        hasEnglishDatabaseMarkers(clean)
          || hasEnglishInstitution(clean)
          || /\b(?:White House|Associated Press|Roper Center|NORC|New York|Washington)\b/i.test(clean)
          || /RFE Item No\./i.test(clean)
          || /\bletterhead\b/i.test(clean)
          || (/\bpamphlet\b/i.test(clean) && (/^[A-Z][A-Za-z0-9 .,:;\-'’()]+,/.test(clean) || /[“"][^”"]+[”"]/.test(clean))),
        "应交代发布机构、保存位置或数据库来源。",
      );
      break;
    }
    case "en-serial": {
      pushMissing(issues, hasEnglishSerialTitle(clean) || /\b(?:issue|newsletter|reprinted in|reprinted from)\b/i.test(clean), "英文连续出版物文献通常应写明刊名或载体名称。");
      pushMissing(issues, hasLooseEnglishDate(clean), "英文连续出版物文献通常应标明年份或日期。");
      pushMissing(issues, hasEnglishDatabaseMarkers(clean) || /\breprinted (?:in|from)\b/i.test(clean) || /(?:Inc\.|Press|Company|Corporation|Corp\.)/i.test(clean), "应交代数据库、馆藏系列、出版者或重印来源。");
      break;
    }
    case "en-photo": {
      pushMissing(issues, /\bphotograph\b/i.test(clean), "照片文献应注明 photograph。");
      pushMissing(issues, hasLooseEnglishDate(clean), "照片文献应标明拍摄/形成时间；无法确定时可写 undated。");
      break;
    }
    case "unknown": {
      issues.push("未能按《历史研究》规则识别该条目类型，需人工核查体例。");
      break;
    }
  }

  return { category, pass: issues.length === 0, issues, basis: HISTORY_STUDY_BASIS };
}

function parseFootnoteDefinitions(lines: string[]): Map<string, ParsedFootnoteDefinition> {
  const out = new Map<string, ParsedFootnoteDefinition>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = line.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
    if (!match) continue;

    const id = (match[1] ?? "").trim();
    const chunks = [(match[2] ?? "").trim()];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j] ?? "";
      if (!next.trim()) break;
      if (/^\[\^([^\]]+)\]:/.test(next)) break;
      if (/^\s{2,}|^\t/.test(next)) {
        chunks.push(next.trim());
        j += 1;
        continue;
      }
      break;
    }

    out.set(id, { id, line: i + 1, text: chunks.join(" ").trim() });
    i = j - 1;
  }
  return out;
}

function parseFootnoteUsage(lines: string[], definitionLines: Set<number>): Map<string, FinalCheckUsageLocation[]> {
  const out = new Map<string, FinalCheckUsageLocation[]>();
  for (let i = 0; i < lines.length; i++) {
    if (definitionLines.has(i + 1)) continue;
    const line = lines[i] ?? "";
    const matches = line.matchAll(/\[\^([^\]]+)\]/g);
    for (const match of matches) {
      const id = String(match[1] ?? "").trim();
      if (!id) continue;
      const bucket = out.get(id) ?? [];
      bucket.push({ line: i + 1, snippet: snippet(line) });
      out.set(id, bucket);
    }
  }
  return out;
}

function parseReferenceEntries(lines: string[]): { primary: ParsedReferenceEntry[]; secondary: ParsedReferenceEntry[] } {
  const primary: ParsedReferenceEntry[] = [];
  const secondary: ParsedReferenceEntry[] = [];
  let currentSection: ReferenceSection | null = null;
  let currentHeading = "";
  let currentEntry: ParsedReferenceEntry | null = null;
  let currentBucket: ParsedReferenceEntry[] | null = null;

  const flush = () => {
    if (!currentEntry || !currentBucket) return;
    currentEntry.raw = currentEntry.raw.trim();
    if (currentEntry.raw) currentBucket.push(currentEntry);
    currentEntry = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const headingMatch = line.match(/^###\s+(.+)$/);
    if (headingMatch) {
      flush();
      const title = (headingMatch[1] ?? "").trim();
      if (/一手/.test(title)) {
        currentSection = "primary";
        currentHeading = title;
        currentBucket = primary;
      } else if (/二手|研究|文献/.test(title)) {
        currentSection = "secondary";
        currentHeading = title;
        currentBucket = secondary;
      } else {
        currentSection = null;
        currentHeading = "";
        currentBucket = null;
      }
      continue;
    }

    if (!currentSection || !currentBucket) continue;
    if (/^##\s+/.test(line)) {
      flush();
      currentSection = null;
      currentHeading = "";
      currentBucket = null;
      continue;
    }

    if (/^-\s+/.test(line)) {
      flush();
      currentEntry = {
        id: `${currentSection}-${currentBucket.length + 1}`,
        section: currentSection,
        heading: currentHeading,
        line: i + 1,
        raw: line.replace(/^-\s+/, "").trim(),
      };
      continue;
    }

    if (currentEntry && line.trim() && !line.startsWith('[^') && !/^###\s+/.test(line)) {
      currentEntry.raw += ` ${line.trim()}`;
      continue;
    }

    if (currentEntry && !line.trim()) flush();
  }

  flush();
  return { primary, secondary };
}

function buildFormatProfiles(values: string[]): FinalCheckFormatProfile[] {
  const buckets = new Map<string, { count: number; examples: string[] }>();
  for (const value of values) {
    const style = classifyCitationStyle(value);
    const bucket = buckets.get(style.kind) ?? { count: 0, examples: [] };
    bucket.count += 1;
    if (bucket.examples.length < 3) bucket.examples.push(snippet(value, 110));
    buckets.set(style.kind, bucket);
  }
  return Array.from(buckets.entries())
    .map(([kind, bucket]) => ({ kind, count: bucket.count, examples: bucket.examples }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

function buildHistoryStudyProfiles(items: Array<{ historyStudy: FinalCheckHistoryStudyStyle; definition?: string; raw?: string }>): FinalCheckFormatProfile[] {
  const buckets = new Map<string, { count: number; examples: string[] }>();
  for (const item of items) {
    const kind = `${item.historyStudy.category}:${item.historyStudy.pass ? "pass" : "fail"}`;
    const bucket = buckets.get(kind) ?? { count: 0, examples: [] };
    bucket.count += 1;
    const sample = item.definition ?? item.raw ?? "";
    if (sample && bucket.examples.length < 3) bucket.examples.push(snippet(sample, 110));
    buckets.set(kind, bucket);
  }
  return Array.from(buckets.entries())
    .map(([kind, bucket]) => ({ kind, count: bucket.count, examples: bucket.examples }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

function buildRepairActions(params: {
  missingIds: string[];
  unusedIds: string[];
  localPathRisks: number;
  placeholderCount: number;
  historyStudyStyleFailures: number;
  risks: FinalCheckRisk[];
}): string[] {
  const actions: string[] = [];
  if (params.localPathRisks > 0) {
    actions.push(`去掉本地路径：把脚注或参考文献中的本机路径改成规范书目信息、档案馆信息或数据库来源（当前 ${params.localPathRisks} 处）。`);
  }
  if (params.placeholderCount > 0) {
    actions.push(`清理 **###** 占位符：正文或脚注里还有 ${params.placeholderCount} 处占位符，需改成真实标题、引文或说明。`);
  }
  if (params.missingIds.length > 0) {
    actions.push(`补脚注定义：为 ${params.missingIds.map((id) => `[^${id}]`).join("、")} 补上完整脚注定义，避免正文悬空引用。`);
  }
  if (params.unusedIds.length > 0) {
    actions.push(`处理未用脚注：检查 ${params.unusedIds.map((id) => `[^${id}]`).join("、")} 是应删除，还是需要在正文补回对应引用。`);
  }
  if (params.historyStudyStyleFailures > 0) {
    const sample = params.risks
      .filter((risk) => risk.code === "history-study-style-footnote" || risk.code === "history-study-style-reference")
      .slice(0, 3)
      .map((risk) => risk.message.trim());
    actions.push(`逐条回修《历史研究》体例：至少还有 ${params.historyStudyStyleFailures} 条脚注未通过；优先补齐责任者、题名、出版项/馆藏信息与页码。${sample.length > 0 ? ` 例如：${sample.join("；")}` : ""}`);
  }
  if (actions.length === 0) {
    actions.push("目前没有明显高风险项；建议人工抽查脚注与参考文献的一一对应关系。");
  }
  return actions;
}

export function analyzeFinalCheck(params: { filePath: string; markdown: string }): FinalCheckReport {
  const lines = params.markdown.split(/\r?\n/);
  const definitionMap = parseFootnoteDefinitions(lines);
  const definitionLines = new Set<number>(Array.from(definitionMap.values()).map((item) => item.line));
  const usageMap = parseFootnoteUsage(lines, definitionLines);
  const refs = parseReferenceEntries(lines);
  const allRefs = [...refs.primary, ...refs.secondary];
  const allIds = new Set<string>([...definitionMap.keys(), ...usageMap.keys()]);
  const placeholderCount = (params.markdown.match(/\*\*###\*\*/g) ?? []).length;
  const risks: FinalCheckRisk[] = [];

  if (placeholderCount > 0) {
    risks.push({
      severity: "error",
      code: "placeholder",
      message: `正文仍含 ${placeholderCount} 个 **###** 占位符。`,
    });
  }

  const footnotes = Array.from(allIds)
    .sort((a, b) => Number(a) - Number(b))
    .map<FinalCheckFootnote>((id) => {
      const definition = definitionMap.get(id);
      const definitionText = definition?.text ?? "";
      const usage = usageMap.get(id) ?? [];
      const matches = allRefs
        .map((ref) => ({ ref, score: scoreMatch(definitionText, ref.raw) }))
        .filter((item) => item.score >= 0.34)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((item) => ({
          referenceId: item.ref.id,
          section: item.ref.section,
          line: item.ref.line,
          raw: item.ref.raw,
          score: Number(item.score.toFixed(2)),
        }));

      const style = classifyCitationStyle(definitionText);
      const historyStudy = analyzeHistoryStudyStyle(definitionText, "footnote");
      const flags: string[] = [];
      if (!definition) flags.push("正文出现但脚注未定义");
      if (definition && usage.length === 0) flags.push("脚注已定义但正文未使用");
      if (/(?:\/Users\/|\\Users\\|tropy_mineru|file:\/\/)/.test(definitionText)) flags.push("脚注包含本地路径");
      if (definitionText.includes("**###**")) flags.push("脚注仍含占位符");
      if (definition && usage.length > 0 && matches.length === 0) flags.push("未能在参考文献区启发式匹配到对应条目");
      if (definition && !historyStudy.pass) flags.push("不符合《历史研究》引文体例");

      return {
        id,
        defined: Boolean(definition),
        ...(definitionText ? { definition: definitionText } : {}),
        ...(definition ? { definitionLine: definition.line } : {}),
        useCount: usage.length,
        usage,
        matches,
        style,
        historyStudy,
        flags,
      };
    });

  const usedIds = footnotes.filter((item) => item.useCount > 0).map((item) => item.id);
  const definedIds = footnotes.filter((item) => item.defined).map((item) => item.id);
  const missingIds = footnotes.filter((item) => item.useCount > 0 && !item.defined).map((item) => item.id);
  const unusedIds = footnotes.filter((item) => item.defined && item.useCount === 0).map((item) => item.id);

  for (const item of footnotes) {
    if (item.useCount > 0 && !item.defined) {
      risks.push({
        severity: "error",
        code: "missing-footnote-definition",
        message: `脚注 [^${item.id}] 在正文中被引用，但没有定义。`,
        line: item.usage[0]?.line,
        footnoteId: item.id,
      });
    }
    if (item.defined && item.useCount === 0) {
      risks.push({
        severity: "warn",
        code: "unused-footnote-definition",
        message: `脚注 [^${item.id}] 已定义但正文未使用。`,
        line: item.definitionLine,
        footnoteId: item.id,
      });
    }
    if (item.definition && /(?:\/Users\/|\\Users\\|tropy_mineru|file:\/\/)/.test(item.definition)) {
      risks.push({
        severity: "error",
        code: "local-path-in-footnote",
        message: `脚注 [^${item.id}] 含本地路径，提交前必须改成《历史研究》规范格式。`,
        line: item.definitionLine,
        footnoteId: item.id,
      });
    }
    if (item.definition?.includes("**###**")) {
      risks.push({
        severity: "error",
        code: "placeholder-in-footnote",
        message: `脚注 [^${item.id}] 含占位符 **###**。`,
        line: item.definitionLine,
        footnoteId: item.id,
      });
    }
    if (item.defined && !item.historyStudy.pass) {
      risks.push({
        severity: "warn",
        code: "history-study-style-footnote",
        message: `脚注 [^${item.id}] 不符合《历史研究》体例：${item.historyStudy.issues.join("；")}`,
        line: item.definitionLine,
        footnoteId: item.id,
      });
    }
  }

  if (refs.primary.length === 0) {
    risks.push({ severity: "warn", code: "missing-primary-references", message: "未识别到“一手史料”参考文献区。" });
  }
  if (refs.secondary.length === 0) {
    risks.push({ severity: "warn", code: "missing-secondary-references", message: "未识别到“二手研究/二手文献”参考文献区。" });
  }

  const referencesPrimary: FinalCheckReferenceEntry[] = refs.primary.map((ref) => ({
    id: ref.id,
    section: ref.section,
    heading: ref.heading,
    line: ref.line,
    raw: ref.raw,
    matchedFootnotes: footnotes.filter((item) => item.matches.some((match) => match.referenceId === ref.id)).map((item) => item.id),
    style: classifyCitationStyle(ref.raw),
    historyStudy: analyzeHistoryStudyStyle(ref.raw, "reference"),
  }));
  const referencesSecondary: FinalCheckReferenceEntry[] = refs.secondary.map((ref) => ({
    id: ref.id,
    section: ref.section,
    heading: ref.heading,
    line: ref.line,
    raw: ref.raw,
    matchedFootnotes: footnotes.filter((item) => item.matches.some((match) => match.referenceId === ref.id)).map((item) => item.id),
    style: classifyCitationStyle(ref.raw),
    historyStudy: analyzeHistoryStudyStyle(ref.raw, "reference"),
  }));

  for (const ref of [...referencesPrimary, ...referencesSecondary]) {
    if (/(?:\/Users\/|\\Users\\|tropy_mineru|file:\/\/)/.test(ref.raw)) {
      risks.push({
        severity: "error",
        code: "local-path-in-reference",
        message: `参考文献条目 ${ref.id} 含本地路径，必须改成标准书目信息。`,
        line: ref.line,
        referenceId: ref.id,
      });
    }
    if (!ref.historyStudy.pass) {
      risks.push({
        severity: "warn",
        code: "history-study-style-reference",
        message: `参考文献条目 ${ref.id} 不完全符合《历史研究》体例：${ref.historyStudy.issues.join("；")}`,
        line: ref.line,
        referenceId: ref.id,
      });
    }
  }

  const historyStudyStyleFailures = footnotes.filter((item) => item.defined && !item.historyStudy.pass).length;
  const errorCount = risks.filter((risk) => risk.severity === "error").length;
  const warningCount = risks.filter((risk) => risk.severity === "warn").length;
  const localPathRisks = risks.filter((risk) => risk.code.includes("local-path")).length;
  const actions = buildRepairActions({
    missingIds,
    unusedIds,
    localPathRisks,
    placeholderCount,
    historyStudyStyleFailures,
    risks,
  });

  return {
    version: 1,
    filePath: params.filePath,
    generatedAt: new Date().toISOString(),
    summary: {
      usedFootnotes: usedIds.length,
      definedFootnotes: definedIds.length,
      missingFootnoteDefinitions: missingIds,
      unusedDefinedFootnotes: unusedIds,
      primaryReferences: referencesPrimary.length,
      secondaryReferences: referencesSecondary.length,
      localPathRisks,
      placeholderCount,
      historyStudyStyleFailures,
      errorCount,
      warningCount,
    },
    footnotes: {
      usedIds,
      definedIds,
      items: footnotes,
    },
    references: {
      primary: referencesPrimary,
      secondary: referencesSecondary,
    },
    formatProfiles: {
      footnotes: buildFormatProfiles(footnotes.map((item) => item.definition ?? "").filter(Boolean)),
      references: buildFormatProfiles([...referencesPrimary, ...referencesSecondary].map((item) => item.raw)),
      historyStudyFootnotes: buildHistoryStudyProfiles(footnotes),
    },
    formatRisks: risks,
    actions,
    notes: [
      ...HISTORY_STUDY_BASIS,
      "《历史研究》核心要求首先落实在脚注体例；参考文献区在本工具中主要承担回查与覆盖面检查，不完全等同于脚注规范。",
      "脚注与参考文献的对应关系采用启发式匹配，只能辅助终审，不能替代人工核对。",
    ],
  };
}

function renderReferenceSection(title: string, items: FinalCheckReferenceEntry[]): string[] {
  const lines: string[] = [`### ${title}`];
  if (items.length === 0) {
    lines.push("- 未识别到条目。", "");
    return lines;
  }

  for (const item of items) {
    const matched = item.matchedFootnotes.length > 0 ? item.matchedFootnotes.map((id) => `[^${id}]`).join("、") : "（未匹配到脚注）";
    const notes = item.style.notes.length > 0 ? `；格式观察：${item.style.notes.join("、")}` : "";
    lines.push(`- [${item.id}] 行 ${item.line}：${item.raw}`);
    lines.push(`  - 推定对应脚注：${matched}${notes}`);
    lines.push(`  - 《历史研究》体例观察：${item.historyStudy.category}${item.historyStudy.pass ? "（大体可接受）" : `（需人工复核：${item.historyStudy.issues.join("；")}）`}`);
  }

  lines.push("");
  return lines;
}

export function renderFinalCheckMarkdown(report: FinalCheckReport): string {
  const lines: string[] = [];
  lines.push("# Histwrite Final Check Report", "");
  lines.push(`- 稿件：${report.filePath}`);
  lines.push(`- 生成时间：${report.generatedAt}`);
  lines.push("");

  lines.push("## 摘要", "");
  lines.push(`- 正文使用脚注：${report.summary.usedFootnotes}`);
  lines.push(`- 已定义脚注：${report.summary.definedFootnotes}`);
  lines.push(`- 未定义脚注：${report.summary.missingFootnoteDefinitions.length > 0 ? report.summary.missingFootnoteDefinitions.map((id) => `[^${id}]`).join("、") : "无"}`);
  lines.push(`- 未使用脚注：${report.summary.unusedDefinedFootnotes.length > 0 ? report.summary.unusedDefinedFootnotes.map((id) => `[^${id}]`).join("、") : "无"}`);
  lines.push(`- 一手史料条目：${report.summary.primaryReferences}`);
  lines.push(`- 二手研究条目：${report.summary.secondaryReferences}`);
  lines.push(`- 本地路径风险：${report.summary.localPathRisks}`);
  lines.push(`- 占位符 **###**：${report.summary.placeholderCount}`);
  lines.push(`- 《历史研究》脚注体例未通过：${report.summary.historyStudyStyleFailures}`);
  lines.push(`- 错误 / 警告：${report.summary.errorCount} / ${report.summary.warningCount}`);
  lines.push("");

  lines.push("## 可回修建议", "");
  for (const action of report.actions) lines.push(`- ${action}`);
  lines.push("");

  lines.push("## 高风险与警告", "");
  if (report.formatRisks.length === 0) {
    lines.push("- 未发现明显格式风险。", "");
  } else {
    for (const risk of report.formatRisks) {
      const loc = typeof risk.line === "number" ? `（行 ${risk.line}）` : "";
      lines.push(`- [${risk.severity}] ${risk.message}${loc}`);
    }
    lines.push("");
  }

  lines.push("## 正文脚注使用图", "");
  for (const item of report.footnotes.items) {
    lines.push(`### [^${item.id}]`, "");
    lines.push(`- 使用次数：${item.useCount}`);
    lines.push(`- 定义状态：${item.defined ? `已定义（行 ${item.definitionLine}）` : "未定义"}`);
    if (item.definition) lines.push(`- 脚注内容：${item.definition}`);
    if (item.usage.length > 0) {
      lines.push(`- 正文位置：${item.usage.map((usage) => `L${usage.line}「${usage.snippet}」`).join("；")}`);
    }
    if (item.matches.length > 0) {
      lines.push(`- 推定对应参考文献：${item.matches.map((match) => `[${match.referenceId}] ${match.raw}（score=${match.score}）`).join("；")}`);
    } else if (item.defined) {
      lines.push("- 推定对应参考文献：未在参考文献区稳定匹配到条目（需人工复核）");
    }
    if (item.style.kind !== "plain" || item.style.notes.length > 0) {
      lines.push(`- 引用格式观察：${item.style.kind}${item.style.notes.length > 0 ? `；${item.style.notes.join("、")}` : ""}`);
    }
    lines.push(`- 《历史研究》体例：${item.historyStudy.category}${item.historyStudy.pass ? "（通过）" : `（未通过：${item.historyStudy.issues.join("；")}）`}`);
    if (item.flags.length > 0) lines.push(`- 标记：${item.flags.join("；")}`);
    lines.push("");
  }

  lines.push("## 参考文献回查", "");
  lines.push(...renderReferenceSection("一手史料", report.references.primary));
  lines.push(...renderReferenceSection("二手研究", report.references.secondary));

  lines.push("## 引用格式样式概览", "");
  lines.push("### 脚注样式", "");
  if (report.formatProfiles.footnotes.length === 0) {
    lines.push("- 无脚注样式数据。", "");
  } else {
    for (const profile of report.formatProfiles.footnotes) {
      lines.push(`- ${profile.kind}：${profile.count} 条；样本：${profile.examples.join(" / ")}`);
    }
    lines.push("");
  }

  lines.push("### 参考文献样式", "");
  if (report.formatProfiles.references.length === 0) {
    lines.push("- 无参考文献样式数据。", "");
  } else {
    for (const profile of report.formatProfiles.references) {
      lines.push(`- ${profile.kind}：${profile.count} 条；样本：${profile.examples.join(" / ")}`);
    }
    lines.push("");
  }

  lines.push("### 《历史研究》脚注体例概览", "");
  if (report.formatProfiles.historyStudyFootnotes.length === 0) {
    lines.push("- 无《历史研究》脚注体例数据。", "");
  } else {
    for (const profile of report.formatProfiles.historyStudyFootnotes) {
      lines.push(`- ${profile.kind}：${profile.count} 条；样本：${profile.examples.join(" / ")}`);
    }
    lines.push("");
  }

  lines.push("## 工具说明", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");

  return `${lines.join("\n").trim()}\n`;
}
