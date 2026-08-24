/**
 * Module that provides function the GUI uses and updates the DOM accordingly
 */

import { CancellationToken, IMap, RGB } from "./common";
import { GUIProcessManager, ProcessResult } from "./guiprocessmanager";
import { ClusteringColorSpace, Settings } from "./settings";

declare function saveSvgAsPng(el: Node, filename: string): void;

let processResult: ProcessResult | null = null;
let cancellationToken: CancellationToken = new CancellationToken();

const timers: IMap<Date> = {};
export function time(name: string) {
    console.time(name);
    timers[name] = new Date();
}

export function timeEnd(name: string) {
    console.timeEnd(name);
    const ms = new Date().getTime() - timers[name].getTime();
    log(name + ": " + ms + "ms");
    delete timers[name];
}

export function log(str: string) {
    $("#log").append("<br/><span>" + str + "</span>");
}

function hexToRgb(hex: string): RGB | null {
    const match = hex.match(/^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
    if (!match) return null;
    return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

export function parseSettings(): Settings {
    const settings = new Settings();

    if ($("#optColorSpaceRGB").prop("checked")) {
        settings.kMeansClusteringColorSpace = ClusteringColorSpace.RGB;
    } else if ($("#optColorSpaceHSL").prop("checked")) {
        settings.kMeansClusteringColorSpace = ClusteringColorSpace.HSL;
    } else if ($("#optColorSpaceLAB").prop("checked")) {
        settings.kMeansClusteringColorSpace = ClusteringColorSpace.LAB;
    }

    const colorSpaceNames = ["RGB", "HSL", "LAB"];
    console.log("Color space selected:", colorSpaceNames[settings.kMeansClusteringColorSpace], "(enum value:", settings.kMeansClusteringColorSpace + ")");

    if ($("#optFacetRemovalLargestToSmallest").prop("checked")) {
        settings.removeFacetsFromLargeToSmall = true;
    } else {
        settings.removeFacetsFromLargeToSmall = false;
    }

    settings.randomSeed = parseInt($("#txtRandomSeed").val() + "");
    settings.kMeansNrOfClusters = parseInt($("#txtNrOfClusters").val() + "");
    settings.kMeansMinDeltaDifference = parseFloat($("#txtClusterPrecision").val() + "");

    settings.removeFacetsSmallerThanNrOfPoints = parseInt($("#txtRemoveFacetsSmallerThan").val() + "");
    settings.maximumNumberOfFacets = parseInt($("#txtMaximumNumberOfFacets").val() + "");

    settings.nrOfTimesToHalveBorderSegments = parseInt($("#txtNrOfTimesToHalveBorderSegments").val() + "");

    settings.narrowPixelStripCleanupRuns = parseInt($("#txtNarrowPixelStripCleanupRuns").val() + "");

    settings.resizeImageIfTooLarge = $("#chkResizeImage").prop("checked");
    settings.resizeImageWidth = parseInt($("#txtResizeWidth").val() + "");
    settings.resizeImageHeight = parseInt($("#txtResizeHeight").val() + "");

    const restrictedColorInput = ($("#txtKMeansColorRestrictions").val() + "").trim();
    if (restrictedColorInput.startsWith("[")) {
        try {
            const jsonData = JSON.parse(restrictedColorInput);
            if (Array.isArray(jsonData)) {
                for (const entry of jsonData) {
                    if (entry && typeof entry === "object" && typeof entry.hex === "string") {
                        const rgb = hexToRgb(entry.hex);
                        if (rgb) {
                            if (typeof entry.label === "string" && entry.label.length > 0) {
                                settings.colorAliases[entry.label] = rgb;
                                settings.kMeansColorRestrictions.push(entry.label);
                            } else {
                                settings.kMeansColorRestrictions.push(rgb);
                            }
                        }
                    }
                }
            }
        } catch {
            // not valid JSON
        }
    }

    if (settings.kMeansColorRestrictions.length > 0) {
        settings.kMeansNrOfClusters = settings.kMeansColorRestrictions.length;
    }

    return settings;
}

export async function process() {
    try {
        const settings: Settings = parseSettings();
        // cancel old process & create new
        cancellationToken.isCancelled = true;
        cancellationToken = new CancellationToken();
        processResult = await GUIProcessManager.process(settings, cancellationToken);
        await updateOutput();
        const tabsOutput = M.Tabs.getInstance(document.getElementById("tabsOutput")!);
        tabsOutput.select("output-pane");
    } catch (e) {
        log("Error: " + e.message + " at " + e.stack);
    }
}

export async function updateOutput() {

    if (processResult != null) {
        const showLabels = $("#chkShowLabels").prop("checked");
        const fill = $("#chkFillFacets").prop("checked");
        const stroke = $("#chkShowBorders").prop("checked");

        const sizeMultiplier = parseInt($("#txtSizeMultiplier").val() + "");
        const fontSize = parseInt($("#txtLabelFontSize").val() + "");

        const fontColor = $("#txtLabelFontColor").val() + "";
        const minLabelSize = parseInt($("#txtMinLabelSize").val() + "") || 0;

        $("#statusSVGGenerate").css("width", "0%");

        $(".status.SVGGenerate").removeClass("complete");
        $(".status.SVGGenerate").addClass("active");

        const svg = await GUIProcessManager.createSVG(processResult.facetResult, processResult.colorsByIndex, processResult.colorLabelsByIndex, sizeMultiplier, fill, stroke, showLabels, fontSize, fontColor, minLabelSize, (progress) => {
            if (cancellationToken.isCancelled) { throw new Error("Cancelled"); }
            $("#statusSVGGenerate").css("width", Math.round(progress * 100) + "%");
        });
        $("#svgContainer").empty().append(svg);
        $("#palette").empty().append(createPaletteHtml(processResult.colorsByIndex, processResult.colorLabelsByIndex));
        ($("#palette .color") as any).tooltip();
        $(".status").removeClass("active");
        $(".status.SVGGenerate").addClass("complete");
    }
}

function createPaletteHtml(colorsByIndex: RGB[], colorLabelsByIndex: string[]) {
    let html = "";
    for (let c: number = 0; c < colorsByIndex.length; c++) {
        const style = "background-color: " + `rgb(${colorsByIndex[c][0]},${colorsByIndex[c][1]},${colorsByIndex[c][2]})`;
        const label = colorLabelsByIndex[c] || (c + "");
        html += `<div class="color" class="tooltipped" style="${style}" data-tooltip="${colorsByIndex[c][0]},${colorsByIndex[c][1]},${colorsByIndex[c][2]}">${label}</div>`;
    }
    return $(html);
}

export function downloadPalettePng() {
    if (processResult == null) { return; }
    const colorsByIndex: RGB[] = processResult.colorsByIndex;
    const colorAliases = processResult.colorAliases;

    const aliasByRgb: IMap<string> = {};
    if (colorAliases) {
        for (const label of Object.keys(colorAliases)) {
            const rgb = colorAliases[label];
            aliasByRgb[rgb[0] + "," + rgb[1] + "," + rgb[2]] = label;
        }
    }
    const hasAliases = Object.keys(aliasByRgb).length > 0;

    const canvas = document.createElement("canvas");

    const nrOfItemsPerRow = 10;
    const nrRows = Math.ceil(colorsByIndex.length / nrOfItemsPerRow);
    const margin = 10;
    const cellWidth = 80;
    const cellHeight = hasAliases ? 80 : 70;

    canvas.width = margin + nrOfItemsPerRow * (cellWidth + margin);
    canvas.height = margin + nrRows * (cellHeight + margin);
    const ctx = canvas.getContext("2d")!;
    ctx.translate(0.5, 0.5);

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < colorsByIndex.length; i++) {
        const color = colorsByIndex[i];

        const x = margin + (i % nrOfItemsPerRow) * (cellWidth + margin);
        const y = margin + Math.floor(i / nrOfItemsPerRow) * (cellHeight + margin);

        ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
        ctx.fillRect(x, y, cellWidth, cellHeight - 20);
        ctx.strokeStyle = "#888";
        ctx.strokeRect(x, y, cellWidth, cellHeight - 20);

        const nrText = i + "";
        ctx.fillStyle = "black";
        ctx.strokeStyle = "#CCC";
        ctx.font = "20px Tahoma";
        const nrTextSize = ctx.measureText(nrText);
        ctx.lineWidth = 2;
        ctx.strokeText(nrText, x + cellWidth / 2 - nrTextSize.width / 2, y + cellHeight / 2 - 5);
        ctx.fillText(nrText, x + cellWidth / 2 - nrTextSize.width / 2, y + cellHeight / 2 - 5);
        ctx.lineWidth = 1;

        if (hasAliases) {
            const alias = aliasByRgb[color[0] + "," + color[1] + "," + color[2]];
            if (alias) {
                ctx.font = "9px Tahoma";
                const aliasTextSize = ctx.measureText(alias);
                ctx.fillStyle = "#555";
                ctx.fillText(alias, x + cellWidth / 2 - aliasTextSize.width / 2, y + cellHeight - 1);
            }
        }
    }

    const dataURL = canvas.toDataURL("image/png");
    const dl = document.createElement("a");
    document.body.appendChild(dl);
    dl.setAttribute("href", dataURL);
    dl.setAttribute("download", "palette.png");
    dl.click();
}

export function downloadPNG() {
    if ($("#svgContainer svg").length > 0) {
        saveSvgAsPng($("#svgContainer svg").get(0), "paintbynumbers.png");
    }
}

/**
 * Cached parsed Hershey glyph data (fetched once per page load).
 * Maps a unicode character to { d: path data string, advanceWidth: number }.
 */
let hersheyGlyphs: Map<string, { d: string; advanceWidth: number }> | null = null;
const HERSHEY_UNITS_PER_EM = 1000;
const HERSHEY_CAP_HEIGHT = 500;

async function ensureHersheyGlyphs(): Promise<Map<string, { d: string; advanceWidth: number }>> {
    if (hersheyGlyphs) return hersheyGlyphs;

    const resp = await fetch("fonts/HersheySans1.svg");
    if (!resp.ok) throw new Error(`Failed to fetch HersheySans1.svg: HTTP ${resp.status}`);
    const text = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "image/svg+xml");

    hersheyGlyphs = new Map();
    for (const glyph of Array.from(doc.querySelectorAll("glyph"))) {
        const unicode = glyph.getAttribute("unicode");
        const d = glyph.getAttribute("d");
        const advW = glyph.getAttribute("horiz-adv-x");
        if (unicode && d && advW) {
            hersheyGlyphs.set(unicode, { d, advanceWidth: parseFloat(advW) });
        }
    }
    return hersheyGlyphs;
}

/**
 * Replaces all <text> elements in svgEl with Hershey single-stroke <path>
 * elements. Paths use fill="none" + stroke, making them true open-path output
 * suitable for CNC plotters, laser engravers, and Inkscape.
 */
async function textLabelsToHersheyPaths(svgEl: SVGSVGElement): Promise<void> {
    const glyphs = await ensureHersheyGlyphs();
    const xmlns = "http://www.w3.org/2000/svg";
    const scale_factor = 1 / HERSHEY_UNITS_PER_EM;
    const capNorm = HERSHEY_CAP_HEIGHT * scale_factor;

    const textEls = Array.from(svgEl.querySelectorAll("text")) as SVGTextElement[];

    for (const textEl of textEls) {
        const text = textEl.textContent ?? "";
        if (!text) continue;

        const cx = parseFloat(textEl.getAttribute("x") ?? "0");
        const cy = parseFloat(textEl.getAttribute("y") ?? "0");
        const fontSize = parseFloat(textEl.getAttribute("font-size") ?? "12");
        const strokeColor = textEl.getAttribute("fill") ?? "black";
        const strokeWidth = Math.max(3, fontSize);

        let totalAdvance = 0;
        for (const ch of text) {
            const g = glyphs.get(ch);
            totalAdvance += g ? g.advanceWidth * scale_factor * fontSize : fontSize * 0.6;
        }

        const baselineSvgY = cy + (capNorm * fontSize) / 2;
        let curX = cx - totalAdvance / 2;

        const g = document.createElementNS(xmlns, "g");

        for (const ch of text) {
            const glyph = glyphs.get(ch);
            if (!glyph) {
                curX += fontSize * 0.6;
                continue;
            }
            const advPx = glyph.advanceWidth * scale_factor * fontSize;
            const s = scale_factor * fontSize;

            const pathEl = document.createElementNS(xmlns, "path");
            pathEl.setAttribute("d", glyph.d);
            pathEl.setAttribute("fill", "none");
            pathEl.setAttribute("stroke", strokeColor);
            pathEl.setAttribute("stroke-width", strokeWidth + "");
            pathEl.setAttribute("stroke-linecap", "round");
            pathEl.setAttribute("stroke-linejoin", "round");
            pathEl.setAttribute("transform", `translate(${curX},${baselineSvgY}) scale(${s},${-s})`);
            g.appendChild(pathEl);
            curX += advPx;
        }

        textEl.parentNode!.replaceChild(g, textEl);
    }
}

export function downloadSVG() {
    if ($("#svgContainer svg").length > 0) {
        const svgEl = $("#svgContainer svg").get(0) as unknown as SVGSVGElement;
        svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");

        const renderAsPaths = (document.getElementById("chkRenderLabelsAsPaths") as HTMLInputElement).checked;

        if (renderAsPaths) {
            textLabelsToHersheyPaths(svgEl).then(() => {
                const svgData = svgEl.outerHTML;
                const preface = '<?xml version="1.0" standalone="no"?>\r\n';
                const svgBlob = new Blob([preface, svgData], { type: "image/svg+xml;charset=utf-8" });
                const svgUrl = URL.createObjectURL(svgBlob);
                const downloadLink = document.createElement("a");
                downloadLink.href = svgUrl;
                downloadLink.download = "paintbynumbers.svg";
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
            });
        } else {
            const svgData = svgEl.outerHTML;
            const preface = '<?xml version="1.0" standalone="no"?>\r\n';
            const svgBlob = new Blob([preface, svgData], { type: "image/svg+xml;charset=utf-8" });
            const svgUrl = URL.createObjectURL(svgBlob);
            const downloadLink = document.createElement("a");
            downloadLink.href = svgUrl;
            downloadLink.download = "paintbynumbers.svg";
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
        }
    }
}

export function loadExample(imgId: string) {
    // load image
    const img = document.getElementById(imgId) as HTMLImageElement;
    const c = document.getElementById("canvas") as HTMLCanvasElement;
    const ctx = c.getContext("2d")!;
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
}
