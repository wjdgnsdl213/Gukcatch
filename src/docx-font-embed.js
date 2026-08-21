/**
 * 워드 문서에 TrueType 폰트를 실제로 심는다 (OOXML 폰트 임베딩, P2-4).
 *
 * `docx` npm 패키지는 폰트 임베딩을 지원하지 않는다 — 문서에 "Pretendard"라는
 * 이름만 적을 수 있고, 실제로 그 폰트가 보이는지는 여는 사람 PC에 그 폰트가
 * 깔려 있는지에 달렸다. 결재 문서는 다른 사람 PC로 전달되므로 그건 도박이다.
 * 그래서 이 모듈이 생성된 .docx(zip)를 직접 열어 폰트 파일을 끼워 넣는다.
 *
 * 알고리즘은 ECMA-376 Part 4 §2.8.1 (Font Embedding)에 정의돼 있다 — Word가
 * "글꼴 포함하여 저장"을 할 때 쓰는 것과 동일한 방식이다:
 *   1. 폰트마다 GUID를 하나씩 만든다.
 *   2. 그 GUID의 16바이트를 그대로 뒤집는다(reverse) — 이게 XOR 키다.
 *      (.NET Guid의 내부 바이트 순서와는 다르다. 문자열을 그대로 파싱한
 *      16바이트를 뒤집는 것뿐이다.)
 *   3. 폰트 파일의 앞 32바이트에 그 16바이트 키를 두 번(0~15, 16~31) 적용해
 *      XOR한다. 32바이트 이후는 원본 그대로 둔다.
 *   4. 원래(뒤집기 전) GUID 문자열을 fontTable.xml의 w:fontKey 속성에 적는다
 *      — Word가 열 때 같은 키로 되돌려서 원본 폰트를 복원한다.
 *
 * 명세 예시로 정확성을 검증했다(원본 001B70DC-...-1EAE → 뒤집으면
 * AE1E8E94-...-1B00, 앞 16바이트 순서를 통째로 뒤집은 것과 일치).
 */

const crypto = require('crypto');

const FONT_RELATIONSHIP_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font';
const OBFUSCATED_FONT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.obfuscatedFont';

function randomGuidBytes() {
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4 (형식만 갖춘다 — Word가 버전을 검사하진 않는다)
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes;
}

function guidBytesToString(bytes) {
  const hex = Buffer.from(bytes).toString('hex').toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * 폰트 파일 앞 32바이트를 난독화한다. GUID를 뒤집은 16바이트를 키로 써서
 * 0~15바이트, 16~31바이트에 각각 한 번씩(=인덱스 mod 16으로) XOR한다.
 */
function obfuscateFont(fontBuffer, guidBytes) {
  const key = Buffer.from(guidBytes).reverse();
  const out = Buffer.from(fontBuffer);
  const limit = Math.min(32, out.length);
  for (let i = 0; i < limit; i++) {
    out[i] ^= key[i % 16];
  }
  return out;
}

/**
 * CT_Settings의 전체 자식 요소 순서(ECMA-376 / datypic.com 스키마 문서 기준,
 * 99개 전부). "몇 개만 훑어서 그 앞/뒤에 끼우기" 식으로는 문서마다 실제로
 * 들어있는 요소 조합이 달라 틀리기 쉽다 — 실제로 이 코드를 처음 짰을 때
 * evenAndOddHeaders(48번)가 있는 문서에서 embedTrueTypeFonts(11번)를 그
 * 뒤에 넣는 사고가 났다(휴리스틱이 compat만 보고 그 앞에 넣었는데,
 * evenAndOddHeaders가 이미 embedTrueTypeFonts보다 뒤에 있었다). 순서가
 * 틀리면 Word가 "복구됨" 경고를 띄우며 열 수 있어 결재 문서로 못 쓴다.
 */
const CT_SETTINGS_ORDER = [
  'writeProtection', 'view', 'zoom', 'removePersonalInformation', 'removeDateAndTime',
  'doNotDisplayPageBoundaries', 'displayBackgroundShape', 'printPostScriptOverText',
  'printFractionalCharacterWidth', 'printFormsData', 'embedTrueTypeFonts', 'embedSystemFonts',
  'saveSubsetFonts', 'saveFormsData', 'mirrorMargins', 'alignBordersAndEdges',
  'bordersDoNotSurroundHeader', 'bordersDoNotSurroundFooter', 'gutterAtTop', 'hideSpellingErrors',
  'hideGrammaticalErrors', 'activeWritingStyle', 'proofState', 'formsDesign', 'attachedTemplate',
  'linkStyles', 'stylePaneFormatFilter', 'stylePaneSortMethod', 'documentType', 'mailMerge',
  'revisionView', 'trackRevisions', 'doNotTrackMoves', 'doNotTrackFormatting', 'documentProtection',
  'autoFormatOverride', 'styleLockTheme', 'styleLockQFSet', 'defaultTabStop', 'autoHyphenation',
  'consecutiveHyphenLimit', 'hyphenationZone', 'doNotHyphenateCaps', 'showEnvelope', 'summaryLength',
  'clickAndTypeStyle', 'defaultTableStyle', 'evenAndOddHeaders', 'bookFoldRevPrinting',
  'bookFoldPrinting', 'bookFoldPrintingSheets', 'drawingGridHorizontalSpacing',
  'drawingGridVerticalSpacing', 'displayHorizontalDrawingGridEvery', 'displayVerticalDrawingGridEvery',
  'doNotUseMarginsForDrawingGridOrigin', 'drawingGridHorizontalOrigin', 'drawingGridVerticalOrigin',
  'doNotShadeFormData', 'noPunctuationKerning', 'characterSpacingControl', 'printTwoOnOne',
  'strictFirstAndLastChars', 'noLineBreaksAfter', 'noLineBreaksBefore', 'savePreviewPicture',
  'doNotValidateAgainstSchema', 'saveInvalidXml', 'ignoreMixedContent', 'alwaysShowPlaceholderText',
  'doNotDemarcateInvalidXml', 'saveXmlDataOnly', 'useXSLTWhenSaving', 'saveThroughXslt', 'showXMLTags',
  'alwaysMergeEmptyNamespace', 'updateFields', 'hdrShapeDefaults', 'footnotePr', 'endnotePr', 'compat',
  'docVars', 'rsids', 'mathPr', 'uiCompat97To2003', 'attachedSchema', 'themeFontLang', 'clrSchemeMapping',
  'doNotIncludeSubdocsInStats', 'doNotAutoCompressPictures', 'forceUpgrade', 'captions',
  'readModeInkLockDown', 'smartTagType', 'schemaLibrary', 'shapeDefaults', 'doNotEmbedSmartTags',
  'decimalSymbol', 'listSeparator',
];

/** settings.xml에 <w:embedTrueTypeFonts w:val="1"/>를 스키마 순서에 맞게 끼워 넣는다. */
function insertEmbedTrueTypeFonts(settingsXml) {
  const tag = '<w:embedTrueTypeFonts w:val="1"/>';
  if (settingsXml.includes('w:embedTrueTypeFonts')) return settingsXml; // 이미 있으면 중복 삽입 방지

  const myIndex = CT_SETTINGS_ORDER.indexOf('embedTrueTypeFonts');

  // 문서에 실제로 존재하는, "이 태그보다 스키마상 뒤"인 요소들을 전부 찾아
  // 그중 XML 문자열에서 가장 먼저 등장하는 것 바로 앞에 끼운다. 실제 문서는
  // 이미 스키마 순서대로 정렬돼 있으므로, "뒤 요소 중 최초 등장 위치"가
  // 곧 올바른 삽입 지점이다.
  let insertAt = -1;
  for (let i = myIndex + 1; i < CT_SETTINGS_ORDER.length; i++) {
    const idx = settingsXml.indexOf(`<w:${CT_SETTINGS_ORDER[i]}`);
    if (idx !== -1 && (insertAt === -1 || idx < insertAt)) insertAt = idx;
  }
  if (insertAt !== -1) return settingsXml.slice(0, insertAt) + tag + settingsXml.slice(insertAt);

  // 뒤 요소가 하나도 없으면(=이 태그가 사실상 마지막 자식) 닫는 태그 바로 앞에 넣는다.
  if (settingsXml.includes('</w:settings>')) {
    return settingsXml.replace('</w:settings>', `${tag}</w:settings>`);
  }
  // settings.xml이 자체 폐쇄 태그(자식 없음)인 경우
  return settingsXml.replace(/<w:settings([^>]*)\/>/, (_m, attrs) => `<w:settings${attrs}>${tag}</w:settings>`);
}

function ensureFntdataContentType(contentTypesXml) {
  if (contentTypesXml.includes('Extension="fntdata"')) return contentTypesXml;
  const entry = `<Default Extension="fntdata" ContentType="${OBFUSCATED_FONT_CONTENT_TYPE}"/>`;
  return contentTypesXml.replace('</Types>', `${entry}</Types>`);
}

function escapeXmlAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 생성된 .docx 버퍼에 폰트를 심어 새 버퍼를 돌려준다.
 *
 * @param {Buffer} docxBuffer - Packer.toBuffer()의 결과 (docx 라이브러리가 이미 만든 문서)
 * @param {string} fontName - 문서 안에서 이 이름으로 참조된 폰트만 심는다.
 *   (docx-report.js가 모든 TextRun에 이 이름을 지정해뒀어야 한다.)
 * @param {{regular: Buffer, bold: Buffer}} fontFiles - TrueType 원본 바이트.
 * @returns {Promise<Buffer>}
 */
async function embedFonts(docxBuffer, fontName, fontFiles) {
  // eslint-disable-next-line global-require
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(docxBuffer);

  const weights = [
    { key: 'regular', tag: 'embedRegular', buf: fontFiles.regular },
    { key: 'bold', tag: 'embedBold', buf: fontFiles.bold },
  ].filter((w) => w.buf);

  if (weights.length === 0) return docxBuffer;

  // ── ① 폰트 파일 난독화 + zip에 추가 ──────────────────────────────────
  const relEntries = [];
  const embedTags = [];
  weights.forEach((w, i) => {
    const guidBytes = randomGuidBytes();
    const guidStr = guidBytesToString(guidBytes);
    const obfuscated = obfuscateFont(w.buf, guidBytes);
    const partName = `font${i + 1}.fntdata`;
    const relId = `rIdFont${i + 1}`;

    zip.file(`word/fonts/${partName}`, obfuscated);
    relEntries.push(
      `<Relationship Id="${relId}" Type="${FONT_RELATIONSHIP_TYPE}" Target="fonts/${partName}"/>`,
    );
    embedTags.push(`<w:${w.tag} r:id="${relId}" w:fontKey="{${guidStr}}"/>`);
  });

  // ── ② fontTable.xml.rels ────────────────────────────────────────────
  // docx 라이브러리가 이 파일을 아예 안 만들거나(구버전 경로), 만들더라도
  // 내용 없이 자체 폐쇄 태그(<Relationships .../>)로 내보내는 경우가 있다
  // — 둘 다 "</Relationships>가 없는" 케이스라 같은 분기로 처리한다.
  const relsPath = 'word/_rels/fontTable.xml.rels';
  const existingRelsFile = zip.file(relsPath);
  const existingRels = existingRelsFile ? await existingRelsFile.async('string') : null;

  let relsXml;
  if (existingRels && existingRels.includes('</Relationships>')) {
    relsXml = existingRels.replace('</Relationships>', `${relEntries.join('')}</Relationships>`);
  } else if (existingRels) {
    relsXml = existingRels.replace(
      /<Relationships([^>]*)\/>/,
      (_m, attrs) => `<Relationships${attrs}>${relEntries.join('')}</Relationships>`,
    );
  } else {
    relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relEntries.join('')}</Relationships>`;
  }
  zip.file(relsPath, relsXml);

  // ── ③ fontTable.xml — 이 폰트 이름 항목에 임베딩 태그 추가 ──────────
  const fontTablePath = 'word/fontTable.xml';
  let fontTableXml = await zip.file(fontTablePath).async('string');
  const escapedName = escapeXmlAttr(fontName);
  const existingFontTag = new RegExp(`<w:font w:name="${escapedName}">([\\s\\S]*?)</w:font>`);
  const newFontEntry =
    `<w:font w:name="${escapedName}">` +
    `<w:family w:val="swiss"/><w:pitch w:val="variable"/>` +
    `${embedTags.join('')}</w:font>`;

  if (existingFontTag.test(fontTableXml)) {
    // 이미 이 이름의 <w:font> 항목이 있으면(동일 이름 재사용 등) 그 안에 끼워 넣는다.
    fontTableXml = fontTableXml.replace(existingFontTag, (_m, inner) =>
      `<w:font w:name="${escapedName}">${inner}${embedTags.join('')}</w:font>`,
    );
  } else if (fontTableXml.includes('</w:fonts>')) {
    fontTableXml = fontTableXml.replace('</w:fonts>', `${newFontEntry}</w:fonts>`);
  } else {
    // docx 라이브러리가 이 이름을 내장 메타데이터 표에서 모르면(Pretendard처럼
    // 낯선 이름) 자식 없이 자체 폐쇄 태그(<w:fonts .../>)로 내보낸다 — 위
    // </w:fonts> 매칭이 안 통하는 경우다. 열고-닫는 형태로 바꾼 뒤 채운다.
    fontTableXml = fontTableXml.replace(
      /<w:fonts([^>]*)\/>/,
      (_m, attrs) => `<w:fonts${attrs}>${newFontEntry}</w:fonts>`,
    );
  }
  zip.file(fontTablePath, fontTableXml);

  // ── ④ Content_Types — fntdata 확장자 등록 ────────────────────────────
  const ctPath = '[Content_Types].xml';
  const ctXml = await zip.file(ctPath).async('string');
  zip.file(ctPath, ensureFntdataContentType(ctXml));

  // ── ⑤ settings.xml — "글꼴을 파일에 포함" 플래그 ─────────────────────
  const settingsPath = 'word/settings.xml';
  const settingsXml = await zip.file(settingsPath).async('string');
  zip.file(settingsPath, insertEmbedTrueTypeFonts(settingsXml));

  return zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = {
  embedFonts,
  obfuscateFont,
  guidBytesToString,
  randomGuidBytes,
  insertEmbedTrueTypeFonts, // 테스트 전용 export — 스키마 순서 로직을 문서 재생성 없이 검증하기 위함
  CT_SETTINGS_ORDER,
};
