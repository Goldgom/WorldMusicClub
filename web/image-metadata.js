// Dimension-only preflight before browser pixel decoding. This is not an image decoder.
// PNG: W3C PNG 3 IHDR/chunk layout. JPEG: frame-marker layout used by libjpeg-turbo.
export const IMAGE_LIMITS = Object.freeze({bytes:5*1024*1024, pixels:16_000_000, axis:16_384});
const PNG = [137,80,78,71,13,10,26,10];
function dimensions(format,width,height) {
  if (!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1) throw Error('Image dimensions must be positive. Convert this file to an ordinary PNG or JPEG.');
  if (width>IMAGE_LIMITS.axis||height>IMAGE_LIMITS.axis||width*height>IMAGE_LIMITS.pixels) throw Error('This image exceeds 16 million pixels or 16,384 pixels on one side. Crop or resize it before importing.');
  return {format,width,height};
}
export function imageMetadata(input) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if (bytes.length>IMAGE_LIMITS.bytes) throw Error('Choose a PNG or JPEG smaller than 5 MiB.');
  const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if (bytes.length>=8&&PNG.every((v,i)=>bytes[i]===v)) {
    if(bytes.length<33||data.getUint32(8)!==13||String.fromCharCode(...bytes.subarray(12,16))!=='IHDR') throw Error('PNG image header is incomplete.');
    const result=dimensions('png',data.getUint32(16),data.getUint32(20));
    let offset=8,sawData=false;
    while(offset+12<=bytes.length) {
      const length=data.getUint32(offset),end=offset+12+length;
      if(end>bytes.length) throw Error('PNG chunk is incomplete.');
      const kind=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
      if(['acTL','fcTL','fdAT'].includes(kind)) throw Error('Animated PNG is not supported for score review. Export one still frame as PNG or JPEG.');
      if(kind==='IHDR'&&offset!==8) throw Error('PNG has more than one image header.');
      if(kind==='IDAT') sawData=true;
      if(kind==='IEND') {if(length!==0||!sawData) throw Error('PNG image data is missing.');return result;}
      offset=end;
    }
    throw Error('PNG image is incomplete.');
  }
  if(bytes[0]===255&&bytes[1]===216) {
    let offset=2;
    while(offset<bytes.length) {
      if(bytes[offset++]!==255) throw Error('JPEG marker is invalid.');
      while(offset<bytes.length&&bytes[offset]===255) offset++;
      const marker=bytes[offset++];
      if(marker===0xd9||marker===0xda) break;
      if(marker===0x01||(marker>=0xd0&&marker<=0xd7)) continue;
      if(offset+2>bytes.length) throw Error('JPEG segment is incomplete.');
      const length=data.getUint16(offset);
      if(length<2||offset+length>bytes.length) throw Error('JPEG segment length is invalid.');
      if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker)) {
        if(![0xc0,0xc1,0xc2].includes(marker)||length<8||bytes[offset+2]!==8) throw Error('This JPEG frame type is unsupported. Convert it to an ordinary PNG or JPEG.');
        const components=bytes[offset+7];
        if(![1,3,4].includes(components)||length!==8+3*components) throw Error('JPEG frame header is invalid.');
        return dimensions('jpeg',data.getUint16(offset+5),data.getUint16(offset+3));
      }
      offset+=length;
    }
    throw Error('JPEG dimensions are missing. Convert the file to an ordinary PNG or JPEG.');
  }
  throw Error('Choose an actual PNG or JPEG image. Renaming a PDF, SVG or other file does not convert it.');
}
