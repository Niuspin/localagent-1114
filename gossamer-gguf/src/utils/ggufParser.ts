import type { GGUFParsedHeader, ModelRuntimeParams, QuantizationType } from '../types/gguf';

const GGUF_MAGIC = 0x46554747; // "GGUF" in little-endian

const GGUF_TYPE = {
  UINT8: 0,
  INT8: 1,
  UINT16: 2,
  INT16: 3,
  UINT32: 4,
  INT32: 5,
  FLOAT32: 6,
  BOOL: 7,
  STRING: 8,
  ARRAY: 9,
  UINT64: 10,
  INT64: 11,
  FLOAT64: 12,
} as const;

const GGUF_FILE_TYPE_MAP: Record<number, QuantizationType> = {
  0: 'F16',
  1: 'F16',
  2: 'Q4_0',
  3: 'Q4_0',
  7: 'Q8_0',
  10: 'Q2_K',
  12: 'Q3_K_M',
  14: 'Q4_K_S',
  15: 'Q4_K_M',
  16: 'Q5_K_S',
  17: 'Q5_K_M',
  18: 'Q6_K',
};

export function inferQuantizationFromName(fileName: string): QuantizationType {
  const upper = fileName.toUpperCase();
  const candidates: QuantizationType[] = [
    'Q4_K_M',
    'Q4_K_S',
    'Q5_K_M',
    'Q5_K_S',
    'Q6_K',
    'Q8_0',
    'Q3_K_M',
    'Q2_K',
    'Q4_0',
    'IQ4_XS',
    'F16',
  ];
  for (const c of candidates) {
    if (upper.includes(c)) return c;
  }
  return 'UNKNOWN';
}

class BinaryReader {
  private view: DataView;
  private bytes: Uint8Array;
  public offset = 0;
  private decoder = new TextDecoder('utf-8');

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
  }

  get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  ensure(n: number) {
    if (this.offset + n > this.bytes.byteLength) {
      throw new Error('HEADER_SLICE_EOF');
    }
  }

  u8(): number {
    this.ensure(1);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  i8(): number {
    this.ensure(1);
    const v = this.view.getInt8(this.offset);
    this.offset += 1;
    return v;
  }

  u16(): number {
    this.ensure(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i16(): number {
    this.ensure(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    this.ensure(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  i32(): number {
    this.ensure(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f32(): number {
    this.ensure(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  u64(): number {
    this.ensure(8);
    const lo = this.view.getUint32(this.offset, true);
    const hi = this.view.getUint32(this.offset + 4, true);
    this.offset += 8;
    return hi * 4294967296 + lo;
  }

  i64(): number {
    this.ensure(8);
    const lo = this.view.getUint32(this.offset, true);
    const hi = this.view.getInt32(this.offset + 4, true);
    this.offset += 8;
    return hi * 4294967296 + lo;
  }

  f64(): number {
    this.ensure(8);
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }

  str(): string {
    const len = this.u64();
    if (len > 2_000_000) {
      throw new Error('STRING_TOO_LARGE');
    }
    this.ensure(len);
    const slice = this.bytes.subarray(this.offset, this.offset + len);
    this.offset += len;
    return this.decoder.decode(slice);
  }

  skipStr() {
    const len = this.u64();
    this.ensure(len);
    this.offset += len;
  }
}

function readValue(reader: BinaryReader, valueType: number, key: string): { display: string; raw: unknown; typeLabel: string } {
  switch (valueType) {
    case GGUF_TYPE.UINT8: {
      const v = reader.u8();
      return { display: String(v), raw: v, typeLabel: 'uint8' };
    }
    case GGUF_TYPE.INT8: {
      const v = reader.i8();
      return { display: String(v), raw: v, typeLabel: 'int8' };
    }
    case GGUF_TYPE.UINT16: {
      const v = reader.u16();
      return { display: String(v), raw: v, typeLabel: 'uint16' };
    }
    case GGUF_TYPE.INT16: {
      const v = reader.i16();
      return { display: String(v), raw: v, typeLabel: 'int16' };
    }
    case GGUF_TYPE.UINT32: {
      const v = reader.u32();
      return { display: String(v), raw: v, typeLabel: 'uint32' };
    }
    case GGUF_TYPE.INT32: {
      const v = reader.i32();
      return { display: String(v), raw: v, typeLabel: 'int32' };
    }
    case GGUF_TYPE.FLOAT32: {
      const v = reader.f32();
      return { display: Number(v.toFixed(4)).toString(), raw: v, typeLabel: 'float32' };
    }
    case GGUF_TYPE.BOOL: {
      const v = reader.u8() !== 0;
      return { display: String(v), raw: v, typeLabel: 'bool' };
    }
    case GGUF_TYPE.STRING: {
      const v = reader.str();
      return { display: v.length > 96 ? `${v.slice(0, 96)}…` : v, raw: v, typeLabel: 'string' };
    }
    case GGUF_TYPE.UINT64: {
      const v = reader.u64();
      return { display: String(v), raw: v, typeLabel: 'uint64' };
    }
    case GGUF_TYPE.INT64: {
      const v = reader.i64();
      return { display: String(v), raw: v, typeLabel: 'int64' };
    }
    case GGUF_TYPE.FLOAT64: {
      const v = reader.f64();
      return { display: Number(v.toFixed(4)).toString(), raw: v, typeLabel: 'float64' };
    }
    case GGUF_TYPE.ARRAY: {
      const elemType = reader.u32();
      const count = reader.u64();
      const scalarSizeMap: Record<number, number> = {
        [GGUF_TYPE.UINT8]: 1,
        [GGUF_TYPE.INT8]: 1,
        [GGUF_TYPE.UINT16]: 2,
        [GGUF_TYPE.INT16]: 2,
        [GGUF_TYPE.UINT32]: 4,
        [GGUF_TYPE.INT32]: 4,
        [GGUF_TYPE.FLOAT32]: 4,
        [GGUF_TYPE.BOOL]: 1,
        [GGUF_TYPE.UINT64]: 8,
        [GGUF_TYPE.INT64]: 8,
        [GGUF_TYPE.FLOAT64]: 8,
      };
      if (elemType in scalarSizeMap) {
        const totalBytes = count * scalarSizeMap[elemType];
        reader.ensure(totalBytes);
        reader.offset += totalBytes;
      } else if (elemType === GGUF_TYPE.STRING) {
        for (let i = 0; i < count; i++) {
          reader.skipStr();
        }
      } else {
        throw new Error(`UNSUPPORTED_ARRAY_TYPE_${elemType}_ON_${key}`);
      }
      return { display: `[Array(${count.toLocaleString()})]`, raw: count, typeLabel: 'array' };
    }
    default:
      throw new Error(`UNKNOWN_GGUF_TYPE_${valueType}`);
  }
}

export async function parseGGUFFileHeader(file: File): Promise<GGUFParsedHeader> {
  // Read first 4MB header slice to support up to 128k vocab GGUF metadata safely
  const sliceSize = Math.min(file.size, 4 * 1024 * 1024);
  const buffer = await file.slice(0, sliceSize).arrayBuffer();
  const reader = new BinaryReader(buffer);

  const magicNum = reader.u32();
  if (magicNum !== GGUF_MAGIC) {
    throw new Error('无效的 GGUF 文件头：未检测到 Magic 标识 (0x46554747 / GGUF)。');
  }

  const version = reader.u32();
  if (version < 2 || version > 3) {
    throw new Error(`不支持的 GGUF 格式版本: v${version}（仅支持 v2 / v3）。`);
  }

  const tensorCount = reader.u64();
  const kvCount = reader.u64();

  const kvMap = new Map<string, unknown>();
  const metadataEntries: Array<{ key: string; value: string; type: string }> = [];

  for (let i = 0; i < kvCount; i++) {
    try {
      const key = reader.str();
      const valueType = reader.u32();
      const parsed = readValue(reader, valueType, key);
      kvMap.set(key, parsed.raw);
      if (metadataEntries.length < 60) {
        metadataEntries.push({
          key,
          value: parsed.display,
          type: parsed.typeLabel,
        });
      }
    } catch {
      // Stop gracefully if the 4MB header window hits an exceptionally huge array (e.g. 256k vocab)
      break;
    }
  }

  const architecture = String(kvMap.get('general.architecture') || 'llama');
  const modelName = String(kvMap.get('general.name') || file.name.replace(/\.gguf$/i, ''));
  const fileTypeRaw = Number(kvMap.get('general.file_type') ?? -1);
  const quantization =
    GGUF_FILE_TYPE_MAP[fileTypeRaw] ?? inferQuantizationFromName(file.name);

  const contextLength = Number(kvMap.get(`${architecture}.context_length`) ?? 8192);
  const embeddingLength = Number(kvMap.get(`${architecture}.embedding_length`) ?? 4096);
  const blockCount = Number(kvMap.get(`${architecture}.block_count`) ?? 32);
  const headCount = Number(kvMap.get(`${architecture}.attention.head_count`) ?? 32);
  const headCountKv = Number(
    kvMap.get(`${architecture}.attention.head_count_kv`) ?? Math.max(1, Math.floor(headCount / 4))
  );
  const vocabSizeRaw = kvMap.get('tokenizer.ggml.tokens');
  const vocabSize = typeof vocabSizeRaw === 'number' ? vocabSizeRaw : 32000;
  const tokenizerModel = String(kvMap.get('tokenizer.ggml.model') || 'gpt2');

  return {
    fileName: file.name,
    fileSizeBytes: file.size,
    magic: 'GGUF',
    version,
    tensorCount,
    kvCount,
    architecture,
    modelName,
    quantization,
    contextLength,
    embeddingLength,
    blockCount,
    headCount,
    headCountKv,
    vocabSize,
    tokenizerModel,
    metadataEntries,
  };
}

export interface MemoryBreakdown {
  weightsTotalGB: number;
  weightsVramGB: number;
  weightsRamGB: number;
  kvCacheGB: number;
  computeBufferGB: number;
  totalVramGB: number;
  totalRamGB: number;
}

export function estimateModelMemory(
  fileSizeGB: number,
  totalLayers: number,
  embeddingLength: number,
  headCountKv: number,
  params: ModelRuntimeParams
): MemoryBreakdown {
  const safeLayers = Math.max(1, totalLayers);
  const offloadedLayers =
    params.nGpuLayers < 0 ? safeLayers : Math.min(safeLayers, Math.max(0, params.nGpuLayers));
  const gpuRatio = offloadedLayers / safeLayers;

  const weightsVramGB = Number((fileSizeGB * gpuRatio).toFixed(2));
  const weightsRamGB = Number((fileSizeGB * (1 - gpuRatio)).toFixed(2));

  // KV Cache bytes = 2 (K+V) * n_layers * n_ctx * (head_dim * n_head_kv) * bytes_per_elem
  // Approximate head_dim = embeddingLength / 32 or ~128 for modern LLMs
  const headDim = Math.max(64, Math.min(256, Math.round(embeddingLength / 32)));
  const kvElemBytes = params.kvCacheType === 'f16' ? 2 : params.kvCacheType === 'q8_0' ? 1.06 : 0.56;
  const kvBytes = 2 * safeLayers * params.nCtx * headCountKv * headDim * kvElemBytes;
  const kvCacheGB = Number((kvBytes / (1024 ** 3)).toFixed(2));

  // Scratch/compute buffer roughly scales with batch & context
  const computeBufferGB = Number((0.28 + (params.nBatch / 2048) * 0.25).toFixed(2));

  const kvOnGpu = gpuRatio > 0 ? kvCacheGB : 0;
  const kvOnCpu = gpuRatio > 0 ? 0 : kvCacheGB;

  return {
    weightsTotalGB: Number(fileSizeGB.toFixed(2)),
    weightsVramGB,
    weightsRamGB,
    kvCacheGB,
    computeBufferGB,
    totalVramGB: Number((weightsVramGB + kvOnGpu + (gpuRatio > 0 ? computeBufferGB : 0)).toFixed(2)),
    totalRamGB: Number((weightsRamGB + kvOnCpu + (gpuRatio === 0 ? computeBufferGB : 0.2)).toFixed(2)),
  };
}

export function buildLlamaServerCommand(
  filePath: string,
  params: ModelRuntimeParams,
  port = 8080
): string {
  const flags = [
    `llama-server`,
    `-m "${filePath}"`,
    `--port ${port}`,
    `-c ${params.nCtx}`,
    `-ngl ${params.nGpuLayers}`,
    `-t ${params.nThreads}`,
    `-b ${params.nBatch}`,
    params.flashAttn ? `--flash-attn` : '',
    params.kvCacheType !== 'f16'
      ? `--cache-type-k ${params.kvCacheType} --cache-type-v ${params.kvCacheType}`
      : '',
    `--temp ${params.temperature}`,
    `--top-p ${params.topP}`,
    `--repeat-penalty ${params.repeatPenalty}`,
  ].filter(Boolean);

  return flags.join(' \\\n  ');
}
