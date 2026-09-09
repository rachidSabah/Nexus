'use client';

import {
  Check,
  Copy,
  Download,
  FileCode,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Send,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { etagFetcher } from '@/lib/etagFetcher';

interface DiscoveredModel {
  id: string;
  providerId?: string;
  owned_by?: string;
  displayName?: string;
  isFree?: boolean;
  freeTier?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  execution_status?: string;
  available?: boolean;
  pricing?: { isFree?: boolean };
  capabilities?: { vision?: boolean; toolCalling?: boolean };
}

interface ModelsResponse {
  object: string;
  data: DiscoveredModel[];
}

interface Attachment {
  name: string;
  type: 'image' | 'text' | 'audio';
  dataUrl?: string;
  textContent?: string;
  file?: File;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
  routedVia?: string;
  latencyMs?: number;
  tokens?: { prompt?: number; completion?: number; total?: number };
}

export default function PlaygroundPage() {
  const { data: modelsData, isLoading: modelsLoading } = useSWR<ModelsResponse>(
    '/api/v1/models?available=true',
    etagFetcher,
    { revalidateOnFocus: false }
  );

  const models = modelsData?.data ?? [];
  const [selectedProvider, setSelectedProvider] = useState<string>('auto');
  const [selectedModel, setSelectedModel] = useState<string>('auto');
  const [sessionId, setSessionId] = useState<string>(() => `playground-${Date.now()}`);

  const providers = React.useMemo(() => {
    const set = new Set<string>();
    for (const m of models) {
      const p = m.providerId || m.owned_by;
      if (p && p !== 'nexus' && p !== 'auto') {
        set.add(p);
      }
    }
    return Array.from(set).sort();
  }, [models]);

  const filteredModels = React.useMemo(() => {
    if (selectedProvider === 'auto') return models;
    return models.filter((m) => (m.providerId || m.owned_by) === selectedProvider);
  }, [models, selectedProvider]);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hello! I am connected to the Agent Nexus Gateway. Ask me anything, write code, or drag-and-drop images and text files to analyze.',
    },
  ]);
  const [input, setInput] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('You are an expert AI assistant.');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [googleSearchGrounding, setGoogleSearchGrounding] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // Set default model once models load
  useEffect(() => {
    if (models.length > 0 && selectedModel === 'auto') {
      const freeModel = models.find((m) => m.pricing?.isFree || m.isFree || (m.providerId || m.owned_by) === 'pollinations');
      if (freeModel) {
        setSelectedModel(freeModel.id);
        const prov = freeModel.providerId || freeModel.owned_by;
        if (prov && prov !== 'nexus') setSelectedProvider(prov);
      }
    }
  }, [models, selectedModel]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const processFiles = async (files: FileList | File[]) => {
    const newAttachments: Attachment[] = [];

    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        newAttachments.push({
          name: file.name,
          type: 'image',
          dataUrl,
          file,
        });
      } else if (file.type.startsWith('audio/')) {
        newAttachments.push({
          name: file.name,
          type: 'audio',
          file,
        });
      } else {
        // Assume text / code / json
        const reader = new FileReader();
        const textContent = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsText(file);
        });
        newAttachments.push({
          name: file.name,
          type: 'text',
          textContent,
          file,
        });
      }
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      await processFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processFiles(e.target.files);
      e.target.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const transcribeAudio = async (att: Attachment) => {
    if (!att.file) return;
    try {
      const formData = new FormData();
      formData.append('file', att.file);
      formData.append('model', 'whisper-1');
      const res = await fetch('/api/v1/audio/transcriptions', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.text) {
          setInput((prev) => (prev ? `${prev} ${data.text}` : data.text));
        }
      }
    } catch (err) {
      console.error('Transcription error:', err);
    }
  };

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || isStreaming) return;

    // Check if image generation requested via command
    if (input.startsWith('/image ') || input.startsWith('/generate ')) {
      const prompt = input.replace(/^\/(?:image|generate)\s+/, '').trim();
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: input,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');

      const assistantId = `asst-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: 'Generating image...' },
      ]);

      try {
        const res = await fetch('/api/v1/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            model: selectedModel.includes('pollinations') || selectedModel === 'auto' ? 'pollinations' : selectedModel,
            size: '1024x1024',
          }),
        });
        const data = await res.json();
        const imgUrl = data.data?.[0]?.url;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: imgUrl ? `Here is your generated image for: "${prompt}"\n\n![${prompt}](${imgUrl})` : 'Failed to generate image.',
                  images: imgUrl ? [imgUrl] : undefined,
                }
              : m
          )
        );
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: `Error generating image: ${(err as Error).message}` } : m
          )
        );
      }
      return;
    }

    // Prepare message payload
    const imageAttachments = attachments.filter((a) => a.type === 'image' && a.dataUrl);
    const textAttachments = attachments.filter((a) => a.type === 'text' && a.textContent);

    let formattedUserContent = input;
    if (textAttachments.length > 0) {
      const attachedTextBlocks = textAttachments
        .map((a) => `[File Attachment: ${a.name}]\n\`\`\`\n${a.textContent}\n\`\`\``)
        .join('\n\n');
      formattedUserContent = `${attachedTextBlocks}\n\n${input}`;
    }

    const userMessageId = `user-${Date.now()}`;
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: input,
      images: imageAttachments.map((a) => a.dataUrl!),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setAttachments([]);

    // Construct OpenAI compatible payload
    const apiMessages: Array<{ role: string; content: unknown }> = [];
    if (systemPrompt.trim()) {
      apiMessages.push({ role: 'system', content: systemPrompt });
    }

    for (const m of messages) {
      if (m.id === 'welcome') continue;
      apiMessages.push({ role: m.role, content: m.content });
    }

    // Add current user turn
    if (imageAttachments.length > 0) {
      const parts: unknown[] = [{ type: 'text', text: formattedUserContent || 'Analyze these images.' }];
      for (const img of imageAttachments) {
        parts.push({
          type: 'image_url',
          image_url: { url: img.dataUrl },
        });
      }
      apiMessages.push({ role: 'user', content: parts });
    } else {
      apiMessages.push({ role: 'user', content: formattedUserContent });
    }

    const assistantMsgId = `asst-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: assistantMsgId, role: 'assistant', content: '' },
    ]);

    setIsStreaming(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const startTime = Date.now();

    try {
      const payload: Record<string, unknown> = {
        model: selectedModel,
        messages: apiMessages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      };
      if (googleSearchGrounding) {
        payload['google_search'] = true;
      }

      const reqHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-session-id': sessionId,
      };
      if (selectedProvider !== 'auto') {
        reqHeaders['x-nexus-provider'] = selectedProvider;
      } else {
        const matched = models.find((m) => m.id === selectedModel);
        const prov = matched?.providerId || matched?.owned_by;
        if (prov && prov !== 'nexus' && prov !== 'auto') {
          reqHeaders['x-nexus-provider'] = prov;
        }
      }

      const res = await fetch('/api/v1/chat/completions', {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const routedViaHeader = res.headers.get('x-routed-via') ?? undefined;

      if (!res.body) {
        throw new Error('No response body from gateway');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamedText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.replace(/^data:\s*/, '');
          if (dataStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              streamedText += delta;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        content: streamedText,
                        routedVia: routedViaHeader,
                        latencyMs: Date.now() - startTime,
                      }
                    : m
                )
              );
            }
          } catch {
            // Ignore partial SSE tokens
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: `Error: ${(err as Error).message}` }
              : m
          )
        );
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const clearChat = () => {
    setSessionId(`playground-${Date.now()}`);
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: 'Chat cleared. Ready for your next request!',
      },
    ]);
  };

  const exportChat = () => {
    const text = messages
      .filter((m) => m.id !== 'welcome')
      .map((m) => `### ${m.role.toUpperCase()}\n\n${m.content}\n`)
      .join('\n---\n\n');
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus-chat-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="relative flex h-screen w-full flex-col overflow-hidden bg-slate-950 text-slate-100"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-cyan-950/80 backdrop-blur-sm border-2 border-dashed border-cyan-400">
          <ImageIcon className="h-16 w-16 text-cyan-400 animate-bounce" />
          <p className="mt-4 text-xl font-semibold text-cyan-200">
            Drop images, documents, or audio files here
          </p>
          <p className="text-sm text-cyan-400/80">
            Images will be encoded for vision models; text files embedded into context
          </p>
        </div>
      )}

      {/* Top Header */}
      <header className="flex h-14 items-center justify-between border-b border-slate-800 bg-slate-900/60 px-6 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-600 shadow-md">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Playground</h1>
          <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs font-medium text-cyan-400 border border-cyan-500/20">
            Interactive Chat & Vision
          </span>
        </div>

        {/* Model Selection & Controls */}
        <div className="flex items-center gap-2">
          {/* Provider Selector */}
          <div className="relative">
            <select
              value={selectedProvider}
              onChange={(e) => {
                const newProv = e.target.value;
                setSelectedProvider(newProv);
                if (newProv !== 'auto') {
                  const firstOfProv = models.find((m) => (m.providerId || m.owned_by) === newProv);
                  if (firstOfProv) setSelectedModel(firstOfProv.id);
                }
              }}
              className="h-9 w-40 rounded-md border border-slate-700 bg-slate-800/80 px-3 pr-8 text-xs font-medium text-slate-200 shadow-sm focus:border-cyan-500 focus:outline-none"
              disabled={modelsLoading}
            >
              <option value="auto">All Providers (Auto)</option>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Model Selector */}
          <div className="relative">
            <select
              value={selectedModel}
              onChange={(e) => {
                const newModel = e.target.value;
                setSelectedModel(newModel);
                const matched = models.find((m) => m.id === newModel);
                const prov = matched?.providerId || matched?.owned_by;
                if (prov && selectedProvider !== 'auto' && prov !== selectedProvider) {
                  setSelectedProvider(prov);
                }
              }}
              className="h-9 w-60 rounded-md border border-slate-700 bg-slate-800/80 px-3 pr-8 text-xs font-medium text-slate-200 shadow-sm focus:border-cyan-500 focus:outline-none"
              disabled={modelsLoading}
            >
              {selectedProvider === 'auto' && (
                <>
                  <option value="auto">auto (Gateway Balanced)</option>
                  <option value="auto:fast">auto:fast (Low Latency)</option>
                  <option value="auto:smart">auto:smart (Frontier Reasoning)</option>
                  <option value="nexus/free">nexus/free (Zero-Cost Free Tier)</option>
                  <option value="fusion">fusion (Multi-Model Consensus)</option>
                </>
              )}
              {selectedProvider === 'auto' ? (
                providers.map((prov) => {
                  const provModels = models.filter((m) => (m.providerId || m.owned_by) === prov);
                  if (provModels.length === 0) return null;
                  return (
                    <optgroup key={prov} label={prov}>
                      {provModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id} {m.pricing?.isFree || m.isFree ? '★ (Free)' : ''}
                        </option>
                      ))}
                    </optgroup>
                  );
                })
              ) : (
                filteredModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} {m.pricing?.isFree || m.isFree ? '★ (Free)' : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition ${
              showSettings
                ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400'
                : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            Parameters
          </button>

          <button
            onClick={clearChat}
            title="Clear conversation"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-slate-400 hover:text-red-400 hover:bg-slate-700 transition"
          >
            <Trash2 className="h-4 w-4" />
          </button>

          <button
            onClick={exportChat}
            title="Export Markdown"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-slate-400 hover:text-cyan-400 hover:bg-slate-700 transition"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat Stream Area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-4 max-w-4xl mx-auto ${
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {msg.role !== 'user' && (
                  <div className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-indigo-600/30 text-indigo-400 border border-indigo-500/30">
                    <Sparkles className="h-4 w-4" />
                  </div>
                )}

                <div
                  className={`group relative rounded-xl px-4 py-3 text-sm shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-cyan-600 text-white max-w-[80%]'
                      : 'bg-slate-900 border border-slate-800 text-slate-200 max-w-[85%]'
                  }`}
                >
                  {/* Images Attached */}
                  {msg.images && msg.images.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {msg.images.map((img, idx) => (
                        <img
                          key={idx}
                          src={img}
                          alt="attachment"
                          className="max-h-60 rounded-lg object-contain border border-white/10"
                        />
                      ))}
                    </div>
                  )}

                  {/* Text Content */}
                  <div className="whitespace-pre-wrap leading-relaxed">
                    {msg.content || (isStreaming && msg.role === 'assistant' ? (
                      <span className="inline-block h-4 w-2 animate-pulse bg-cyan-400" />
                    ) : null)}
                  </div>

                  {/* Metadata banner on assistant message */}
                  {msg.role === 'assistant' && (msg.routedVia || msg.latencyMs) && (
                    <div className="mt-2 flex items-center gap-3 border-t border-slate-800/80 pt-2 text-[10px] text-slate-400 font-mono">
                      {msg.routedVia && (
                        <span>
                          via <strong className="text-cyan-400">{msg.routedVia}</strong>
                        </span>
                      )}
                      {msg.latencyMs && <span>{msg.latencyMs}ms</span>}
                      <button
                        onClick={() => copyToClipboard(msg.content, msg.id)}
                        className="ml-auto opacity-0 group-hover:opacity-100 transition text-slate-400 hover:text-slate-200"
                        title="Copy message"
                      >
                        {copiedId === msg.id ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input & Attachments Bar */}
          <div className="border-t border-slate-800 bg-slate-900/80 p-4 backdrop-blur">
            <div className="mx-auto max-w-4xl space-y-2">
              {/* Attachment Preview Chips */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 pb-2">
                  {attachments.map((att, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/90 px-2.5 py-1.5 text-xs text-slate-300"
                    >
                      {att.type === 'image' ? (
                        <ImageIcon className="h-3.5 w-3.5 text-cyan-400" />
                      ) : att.type === 'audio' ? (
                        <Mic className="h-3.5 w-3.5 text-pink-400" />
                      ) : (
                        <FileCode className="h-3.5 w-3.5 text-indigo-400" />
                      )}
                      <span className="max-w-40 truncate">{att.name}</span>
                      {att.type === 'audio' && (
                        <button
                          onClick={() => transcribeAudio(att)}
                          className="text-[10px] bg-cyan-600 hover:bg-cyan-500 text-white px-1.5 py-0.5 rounded"
                          title="Transcribe with Whisper"
                        >
                          Transcribe
                        </button>
                      )}
                      <button
                        onClick={() => removeAttachment(i)}
                        className="text-slate-400 hover:text-red-400 ml-1"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Chat Textarea Box */}
              <div className="relative flex items-end gap-2 rounded-xl border border-slate-700 bg-slate-800/80 p-2 shadow-inner focus-within:border-cyan-500">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileInputChange}
                  multiple
                  className="hidden"
                  accept="image/*,.txt,.json,.js,.ts,.py,.md,.csv,.yaml,.yml,audio/*"
                />

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-700 hover:text-cyan-400 transition"
                  title="Attach images, documents, or audio"
                >
                  <Paperclip className="h-4 w-4" />
                </button>

                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Send a prompt, ask code questions, or type /image <prompt> to generate art..."
                  rows={2}
                  className="flex-1 resize-none bg-transparent p-1.5 text-sm text-slate-100 placeholder-slate-400 focus:outline-none"
                />

                {isStreaming ? (
                  <button
                    onClick={handleStop}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white hover:bg-red-500 transition shadow-md"
                    title="Stop generation"
                  >
                    <Square className="h-4 w-4 fill-white" />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() && attachments.length === 0}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-40 disabled:hover:bg-cyan-600 transition shadow-md"
                    title="Send message"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="flex justify-between text-[11px] text-slate-500 px-1">
                <span>Tip: Drag and drop files anywhere or type /image to generate visuals</span>
                <span>Enter to send, Shift+Enter for newline</span>
              </div>
            </div>
          </div>
        </div>

        {/* Parameters Sidebar */}
        {showSettings && (
          <aside className="w-80 border-l border-slate-800 bg-slate-900/90 p-5 overflow-y-auto space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-semibold text-sm text-slate-200">Execution Parameters</h3>
              <button
                onClick={() => setShowSettings(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* System Prompt */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-400">System Instruction</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            {/* Temperature Slider */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium">
                <span className="text-slate-400">Temperature</span>
                <span className="text-cyan-400">{temperature}</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-cyan-500"
              />
              <span className="text-[10px] text-slate-500">Lower = focused & deterministic, higher = creative</span>
            </div>

            {/* Max Output Tokens */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium">
                <span className="text-slate-400">Max Tokens</span>
                <span className="text-cyan-400">{maxTokens}</span>
              </div>
              <input
                type="range"
                min="256"
                max="16384"
                step="256"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
                className="w-full accent-cyan-500"
              />
            </div>

            {/* Google Grounding Toggle */}
            <div className="pt-2 border-t border-slate-800">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <span className="text-xs font-medium text-slate-300">Google Search Grounding</span>
                  <p className="text-[10px] text-slate-500">Attach live search citations (Gemini models)</p>
                </div>
                <input
                  type="checkbox"
                  checked={googleSearchGrounding}
                  onChange={(e) => setGoogleSearchGrounding(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-cyan-600 focus:ring-cyan-500"
                />
              </label>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
