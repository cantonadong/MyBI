import { t } from "./i18n";
import { getInstanceByDom } from 'echarts';
// Export the current card at full resolution without changing its layout or aspect ratio.
export async function chartImage(element: HTMLElement): Promise<Blob> {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height || element.querySelector('.tile-error,[role=alert]')) throw new Error(t("图表尚未就绪，请加载完成后复制"));
  const scale = Math.max(3, window.devicePixelRatio || 1, ...Array.from(element.querySelectorAll('canvas')).map(canvas => canvas.width / (canvas.getBoundingClientRect().width || canvas.width || 1)));
  const layers: { canvas: HTMLCanvasElement; bounds: DOMRect }[] = [];
  const clone = (node: Node): Node => {
    if (!(node instanceof Element)) return node.cloneNode();
    if (node.matches('.tile-actions,.tile-drag-handle,.react-resizable-handle')) return document.createTextNode('');
    const chart = node instanceof HTMLElement && node.matches('.chart-view') ? getInstanceByDom(node) : undefined;
    const copy = node.cloneNode(false) as HTMLElement;
    const computed = getComputedStyle(node);
    for (const key of Array.from(computed)) (copy as HTMLElement).style.setProperty(key, computed.getPropertyValue(key));
    if (node.matches('.data-time')) copy.style.visibility = 'hidden';
    if (chart) layers.push({ canvas: chart.renderToCanvas({ pixelRatio: scale, backgroundColor: '#fff' }), bounds: node.getBoundingClientRect() });
    else if (node instanceof HTMLCanvasElement) layers.push({ canvas: node, bounds: node.getBoundingClientRect() });
    else {
      for (const child of Array.from(node.childNodes)) copy.appendChild(clone(child));
      if (node.scrollLeft || node.scrollTop) {
        const content = document.createElement('div');
        Object.assign(content.style, { width: `${node.scrollWidth}px`, height: `${node.scrollHeight}px`, transform: `translate(${-node.scrollLeft}px, ${-node.scrollTop}px)` });
        while (copy.firstChild) content.appendChild(copy.firstChild);
        copy.appendChild(content);
        (copy as HTMLElement).style.overflow = 'hidden';
      }
    }
    return copy;
  };
  const card = clone(element) as HTMLElement;
  const borderWidth = getComputedStyle(element).borderWidth;
  // Remove logical border properties too: they otherwise override physical colors in the snapshot.
  for (const key of Array.from(card.style)) if (key.startsWith('border')) card.style.removeProperty(key);
  Object.assign(card.style, { transform: 'none', position: 'relative', left: '0', top: '0', margin: '0', width: `${rect.width}px`, height: `${rect.height}px`, boxShadow: 'none', border: `${borderWidth} solid #fff`, borderRadius: '0', outline: 'none', backgroundColor: '#fff' });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(rect.width * scale)}" height="${Math.round(rect.height * scale)}" viewBox="0 0 ${rect.width} ${rect.height}"><foreignObject width="${rect.width}" height="${rect.height}">${new XMLSerializer().serializeToString(card)}</foreignObject></svg>`;
  const image = new Image();
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(rect.width * scale); canvas.height = Math.round(rect.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error(t("无法生成图表图片"));
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const layer of layers) {
    context.drawImage(layer.canvas, (layer.bounds.left - rect.left) * scale, (layer.bounds.top - rect.top) * scale, layer.bounds.width * scale, layer.bounds.height * scale);
  }
  const timestamp = element.querySelector<HTMLElement>('.data-time');
  if (timestamp) {
    const bounds = timestamp.getBoundingClientRect(), style = getComputedStyle(timestamp);
    context.save();
    context.scale(scale, scale);
    context.font = style.font;
    context.fillStyle = style.color;
    context.textBaseline = 'top';
    context.fillText(timestamp.textContent || '', bounds.left - rect.left + parseFloat(style.paddingLeft), bounds.top - rect.top + parseFloat(style.paddingTop));
    context.restore();
  }
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(t("无法生成图表图片"))), 'image/png'));
}
