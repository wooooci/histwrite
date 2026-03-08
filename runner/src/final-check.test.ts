import { describe, expect, it } from "vitest";

import { analyzeFinalCheck, renderFinalCheckMarkdown } from "./final-check.js";

type CitationCase = {
  id: string;
  category: string;
  citation: string;
  section: "primary" | "secondary";
};

function buildMarkdown(cases: CitationCase[]): string {
  const body = cases.map((item) => `正文${item.id}。[^${item.id}]`).join(" ");
  const primary = cases.filter((item) => item.section === "primary");
  const secondary = cases.filter((item) => item.section === "secondary");

  return [
    "# 标题",
    "",
    body,
    "",
    "## 参考文献",
    "",
    "### 一手史料",
    ...(primary.length > 0 ? primary.map((item) => `- ${item.citation}`) : ["- 示例一手史料占位"]),
    "",
    "### 二手研究",
    ...(secondary.length > 0 ? secondary.map((item) => `- ${item.citation}`) : ["- 示例二手研究占位"]),
    "",
    ...cases.map((item) => `[^${item.id}]: ${item.citation}`),
    "",
  ].join("\n");
}

describe("final-check history study style", () => {
  it("covers every 历史研究 citation category with examples", () => {
    const cases: CitationCase[] = [
      {
        id: "1",
        category: "cn-book",
        section: "secondary",
        citation: "赵景深：《文坛忆旧》，上海：北新书局，1948年，第43页。",
      },
      {
        id: "2",
        category: "cn-chapter",
        section: "secondary",
        citation: "杜威·佛克马：《走向新世界主义》，王宁、薛晓源编：《全球化与后殖民批评》，北京：中央编译出版社，1999年，第247-266页。",
      },
      {
        id: "3",
        category: "cn-journal",
        section: "secondary",
        citation: "何龄修：《读顾诚〈南明史〉》，《中国史研究》1998年第3期。",
      },
      {
        id: "4",
        category: "cn-newspaper",
        section: "secondary",
        citation: "《上海各路商界总联合会致外交部电》，《民国日报》（上海）1925年8月14日，第4版。",
      },
      {
        id: "5",
        category: "cn-thesis",
        section: "secondary",
        citation: "方明东：《罗隆基政治思想研究（1913-1949）》，博士学位论文，北京师范大学历史系，2000年，第67页。",
      },
      {
        id: "6",
        category: "cn-conference",
        section: "secondary",
        citation: "任东来：《对国际体制和国际制度的理解和翻译》，全球化与亚太区域化国际研讨会论文，天津，2000年6月，第9页。",
      },
      {
        id: "7",
        category: "cn-archive",
        section: "primary",
        citation: "《傅良佐致国务院电》，1917年9月15日，北洋档案1011-5961，中国第二历史档案馆藏。",
      },
      {
        id: "8",
        category: "cn-turn-cited",
        section: "secondary",
        citation: "章太炎：《在长沙晨光学校演说》，1925年10月，转引自汤志钧：《章太炎年谱长编》下册，北京：中华书局，1979年，第823页。",
      },
      {
        id: "9",
        category: "cn-electronic",
        section: "secondary",
        citation: "王明亮：《关于中国学术期刊标准化数据库系统工程的进展》，1998年8月16日，http://www.cajcd.cn/pub/wml.txt/980810-2.html，1998年10月4日。",
      },
      {
        id: "10",
        category: "cn-ancient",
        section: "primary",
        citation: "《旧唐书》卷9《玄宗纪下》，北京：中华书局，1975年标点本，第233页。",
      },
      {
        id: "11",
        category: "en-book",
        section: "secondary",
        citation: "Peter Brooks, Troubling Confessions: Speaking Guilt in Law and Literature, Chicago: University of Chicago Press, 2000, p.48.",
      },
      {
        id: "12",
        category: "en-journal",
        section: "secondary",
        citation: "Heath B. Chamberlain, “On the Search for Civil Society in China,” Modern China, vol. 19, no. 2 (April 1993), pp.199-215.",
      },
      {
        id: "13",
        category: "en-chapter",
        section: "secondary",
        citation: "R. S. Schfield, “The Impact of Scarcity and Plenty on Population Change in England,” in R. I. Rotberg and T. K. Rabb, eds., Hunger and History: The Impact of Changing Food Production and Consumption Pattern on Society, Cambridge, Mass: Cambridge University Press, 1983, p.79.",
      },
      {
        id: "14",
        category: "en-archive",
        section: "primary",
        citation: "Nixon to Kissinger, February 1, 1969, Box 1032, NSC Files, Nixon Presidential Material Project (NPMP), National Archives II, College Park, MD.",
      },
      {
        id: "15",
        category: "en-thesis",
        section: "secondary",
        citation: "Jonathan Herzog, The Hammer and the Cross: America’s Holy War against Communism, PhD diss., Stanford University, 2008, p.144.",
      },
      {
        id: "16",
        category: "en-document",
        section: "primary",
        citation: "Harry S. Truman, \"Veto Message Returning H. R. 9490,\" The White House, September 22, 1950.",
      },
      {
        id: "16a",
        category: "en-document",
        section: "primary",
        citation: "Crusade for Freedom manifesto, undated pamphlet.",
      },
      {
        id: "17",
        category: "en-serial",
        section: "primary",
        citation: "Faith and Freedom, 1956, Social Documents Collection, University of Iowa, Political Extremism and Radicalism (Gale Primary Sources), document CHPJUP706316396, accessed December 11, 2025.",
      },
      {
        id: "18",
        category: "en-newspaper",
        section: "primary",
        citation: "Green Bay Press-Gazette, September 18, 1959, p. 2.",
      },
      {
        id: "19",
        category: "en-photo",
        section: "primary",
        citation: "George Rodger, \"Those Balloons from Berchtesgaden,\" photograph, undated.",
      },
    ];

    const report = analyzeFinalCheck({ filePath: "/tmp/draft.md", markdown: buildMarkdown(cases) });
    const byId = new Map(report.footnotes.items.map((item) => [item.id, item]));

    expect(report.summary.historyStudyStyleFailures).toBe(0);
    for (const item of cases) {
      const footnote = byId.get(item.id);
      expect(footnote?.historyStudy.category).toBe(item.category);
      expect(footnote?.historyStudy.pass).toBe(true);
    }
  });

  it("accepts repeated citations and 间接引文 simplification", () => {
    const cases: CitationCase[] = [
      {
        id: "1",
        category: "cn-book",
        section: "secondary",
        citation: "赵景深：《文坛忆旧》，第24页。",
      },
      {
        id: "2",
        category: "cn-chapter",
        section: "secondary",
        citation: "鲁迅：《中国小说的历史的变迁》，《鲁迅全集》第9册，第326页。",
      },
      {
        id: "3",
        category: "cn-book",
        section: "secondary",
        citation: "参见邱陵编著：《书籍装帧艺术简史》，哈尔滨：黑龙江人民出版社，1984年，第28－29页。",
      },
      {
        id: "4",
        category: "cn-book",
        section: "secondary",
        citation: "详见张树年主编：《张元济年谱》，北京：商务印书馆，1991年，第6章。",
      },
    ];

    const report = analyzeFinalCheck({ filePath: "/tmp/draft.md", markdown: buildMarkdown(cases) });
    const byId = new Map(report.footnotes.items.map((item) => [item.id, item]));

    expect(report.summary.historyStudyStyleFailures).toBe(0);
    expect(byId.get("1")?.historyStudy.pass).toBe(true);
    expect(byId.get("2")?.historyStudy.pass).toBe(true);
    expect(byId.get("3")?.historyStudy.pass).toBe(true);
    expect(byId.get("4")?.historyStudy.pass).toBe(true);
  });

  it("recognizes real-world English archive, serial, and See-prefixed citations", () => {
    const cases: CitationCase[] = [
      {
        id: "1",
        category: "en-archive",
        section: "primary",
        citation: "News Features, 1944–1993, Series I: Writers, 1944–1979 (AP39.5), Box 58, Folder 740, Associated Press Corporate Archives, Associated Press Collections Online (Gale Primary Sources), document ADXYJI764026075, accessed December 7, 2025.",
      },
      {
        id: "2",
        category: "en-document",
        section: "primary",
        citation: "White House, \"Report to President Eisenhower on International Information Activities,\" June 30, 1953, U.S. Declassified Documents Online (Gale Primary Sources), document CK2349103928, accessed December 2, 2025.",
      },
      {
        id: "3",
        category: "en-serial",
        section: "primary",
        citation: "See Free Men Speak, Inc., February 15, 1955–December 1959, Political Extremism and Radicalism (Gale Primary Sources), document DDPHGV454350419, accessed December 10, 2025.",
      },
    ];

    const report = analyzeFinalCheck({ filePath: "/tmp/draft.md", markdown: buildMarkdown(cases) });
    const byId = new Map(report.footnotes.items.map((item) => [item.id, item]));

    expect(report.summary.historyStudyStyleFailures).toBe(0);
    expect(byId.get("1")?.historyStudy.category).toBe("en-archive");
    expect(byId.get("2")?.historyStudy.category).toBe("en-document");
    expect(byId.get("3")?.historyStudy.category).toBe("en-serial");
    expect(byId.get("3")?.historyStudy.pass).toBe(true);
  });

  it("accepts bibliography-style references in reference section", () => {
    const markdown = [
      "# 标题",
      "",
      "正文。",
      "",
      "## 参考文献",
      "",
      "### 一手史料",
      "- Smith, Walter Bedell. Letter to Walter Lippmann. Crusade for Freedom letterhead, New York, January 22, 1955.",
      "- Unclassified translation, \"The Results of Operation 'Veto' in Technical Battal'ons of the CSR People's Army.\" RFE Item No. 8238/54, 1954.",
      "- Rodger, George. \"Those Balloons from Berchtesgaden.\" Photograph. Undated.",
      "",
      "### 二手研究",
      "- Osgood, Kenneth A. Form before Substance: Eisenhower's Commitment to Psychological Warfare and Negotiations with the Enemy. Diplomatic History 24, no. 3 (Summer 2000): 405–433.",
      "- Medhurst, Martin J. Eisenhower and the Crusade for Freedom: The Rhetorical Origins of a Cold War Campaign. Presidential Studies Quarterly 27, no. 4 (Fall 1997): 646–661.",
      "- Whyte, Jeffrey. Covert Crusade. In The Birth of Psychological War: Propaganda, Espionage, and Military Violence from WWII to the Vietnam War. London: The British Academy, 2023.",
      "",
    ].join("\n");

    const report = analyzeFinalCheck({ filePath: "/tmp/references.md", markdown });
    const referenceWarnings = report.formatRisks.filter((risk) => risk.referenceId);

    expect(referenceWarnings).toHaveLength(0);
  });

  it("reports 历史研究 risks and includes style section in markdown report", () => {
    const markdown = [
      "# 标题",
      "",
      "正文。[^1]",
      "",
      "## 参考文献",
      "",
      "### 二手研究",
      "- /tmp/tropy_mineru/foo.md",
      "",
      "[^1]: /tmp/tropy_mineru/foo.md **###**",
      "",
    ].join("\n");

    const report = analyzeFinalCheck({ filePath: "/tmp/draft.md", markdown });
    const rendered = renderFinalCheckMarkdown(report);

    expect(report.summary.historyStudyStyleFailures).toBeGreaterThan(0);
    expect(report.formatRisks.some((risk) => risk.code === "local-path-in-footnote")).toBe(true);
    expect(report.formatRisks.some((risk) => risk.code === "placeholder")).toBe(true);
    expect(rendered).toContain("《历史研究》脚注体例未通过");
    expect(rendered).toContain("《历史研究》体例");
  });

  it("renderFinalCheckMarkdown emits actionable repair section without hardcoded local rule path", () => {
    const markdown = [
      "# 标题",
      "",
      "正文。[^1] **###**",
      "",
      "## 参考文献",
      "",
      "### 一手史料",
      "- 示例一手史料",
      "",
      "### 二手研究",
      "- 示例二手研究",
      "",
      "[^1]: 参见 file:///tmp/foo.pdf。",
      "",
    ].join("\n");

    const report = analyzeFinalCheck({ filePath: "/tmp/draft.md", markdown });
    const rendered = renderFinalCheckMarkdown(report);

    expect(rendered).toContain("## 可回修建议");
    expect(rendered).toContain("去掉本地路径");
    expect(rendered).toContain("清理 **###** 占位符");
    expect(rendered).not.toContain("/tmp/history-study-style-guide.pdf");
  });

});
