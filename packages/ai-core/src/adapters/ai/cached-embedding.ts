import type { IEmbeddingProvider } from "../../core/ports.js";

export class CachedEmbeddingProvider implements IEmbeddingProvider {
  private cache: Map<string, number[]> = new Map();
  private fallback?: IEmbeddingProvider;

  constructor(fallback?: IEmbeddingProvider) {
    this.fallback = fallback;
  }

  async embed(text: string): Promise<number[]> {
    const hash = this.hashText(text);
    if (this.cache.has(hash)) {
      return this.cache.get(hash)!;
    }
    if (this.fallback) {
      const embedding = await this.fallback.embed(text);
      this.cache.set(hash, embedding);
      return embedding;
    }
    // Return dummy embedding if no fallback
    return new Array(768).fill(0);
  }

  //Add type annotations to the map function for better type safety
  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }

  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}
