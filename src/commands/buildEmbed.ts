import { EditorRange, resolveSubpath, stripHeading, TFile } from "obsidian";
import {
  DEFAULT_DISPLAY,
  DEFAULT_JOIN,
  Embed,
  EmbedDisplay,
  EmbedOptions,
  serialize,
} from "../model/embed";
import {
  posIndex,
  PosRange,
  Range,
  StringRange,
  WholeString,
} from "../model/range";
import { isUnique, uniqueStrRange } from "../util/stringSearch";
import { scopeSubpath } from "../util/obsidian/subpath";

export interface CopySettings {
  defaultDisplay?: EmbedDisplay;
  defaultShow: EmbedOptions;
  showMobileButton: boolean;
}

export function buildEmbed(
  settings: CopySettings,
  file: TFile,
  text: string,
  editorRanges: EditorRange[]
): string {
  const fileCache = app.metadataCache.getFileCache(file);
  const spanRange: EditorRange = {
    from: editorRanges[0].from,
    to: editorRanges[editorRanges.length - 1].to,
  };
  const subpath = scopeSubpath(fileCache, spanRange, stripHeading);

  let scopedText = text;
  let lineOffset = 0;
  if (subpath.length > 0) {
    const subpathResult = resolveSubpath(fileCache, subpath);
    if (!subpathResult) {
      console.log("Could not copy reference, please file a bug report");
    } else {
      scopedText = text.slice(
        subpathResult.start.offset,
        subpathResult.end?.offset
      );
      lineOffset = subpathResult.start.line;
    }
  }

  const ranges: Range[] = editorRanges.map((editorRange) => {
    const selectedText = text.slice(
      posIndex(text, editorRange.from),
      posIndex(text, editorRange.to)
    );
    const adjustedRange: EditorRange = {
      from: { line: editorRange.from.line - lineOffset, ch: editorRange.from.ch },
      to: { line: editorRange.to.line - lineOffset, ch: editorRange.to.ch },
    };
    return getBestRange(scopedText, selectedText, adjustedRange);
  });

  const embed: Embed = {
    file: app.metadataCache.fileToLinktext(file, "/", true),
    subpath: subpath,
    ranges: ranges.filter((r) => r !== null),
    join: DEFAULT_JOIN,
    show: {
      author: false,
      title: false,
      ...settings.defaultShow,
    },
    display: settings.defaultDisplay || DEFAULT_DISPLAY,
  };
  return serialize(embed);
}

function getBestRange(
  doc: string,
  selectedText: string,
  selectedRange: EditorRange
): Range {
  if (doc === selectedText) {
    return null;
  }
  if (isUnique(doc, selectedText)) {
    const points = uniqueStrRange(doc, selectedText);
    if (points.length === 1) {
      return new WholeString(points[0]);
    } else {
      return new StringRange(points[0], points[1]);
    }
  } else {
    return new PosRange(selectedRange.from, selectedRange.to);
  }
}
