export default async function handler(req, res) {
  const id = String(req.query.videoId || '').trim();
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid video id' });
  }

  // Piped exposes browser-playable proxy URLs, including combined MP4 streams.
  // We try several maintained public API instances before falling back to
  // YouTube InnerTube direct URLs.
  const pipedInstances = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.syncpundit.io',
    'https://pipedapi.tokhmi.xyz',
    'https://pipedapi.moomoo.me',
    'https://api-piped.mha.fi',
  ];

  let lastError = 'No playable stream found';
  let details = null;

  for (const base of pipedInstances) {
    try {
      const r = await fetch(`${base}/streams/${encodeURIComponent(id)}`, {
        headers: { 'accept': 'application/json' },
      });
      if (!r.ok) {
        lastError = `Piped request failed (${r.status})`;
        continue;
      }
      const d = await r.json();
      details = {
        id,
        title: d.title || 'Video',
        channel: d.uploader || '',
        duration: Number(d.duration || 0),
        thumbnail: d.thumbnailUrl || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        isLive: !!d.livestream,
      };

      const formats = (d.videoStreams || [])
        .filter(f => f && f.url && f.videoOnly === false)
        .filter(f => String(f.mimeType || '').toLowerCase().startsWith('video/mp4'))
        .map(f => ({
          url: f.url,
          quality: f.quality || (f.height ? `${f.height}p` : 'Auto'),
          height: Number(f.height || 0),
          width: Number(f.width || 0),
          mimeType: 'video/mp4',
          bitrate: Number(f.bitrate || 0),
        }))
        .sort((a, b) => (b.height - a.height) || (b.bitrate - a.bitrate));

      if (formats.length) {
        res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
        return res.status(200).json({ video: details, formats, source: 'piped' });
      }

      // Livestreams can expose HLS through Piped.
      if (d.hls) {
        res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
        return res.status(200).json({
          video: details,
          formats: [{ url: d.hls, quality: 'Live', height: 0, width: 0, mimeType: 'application/x-mpegURL', bitrate: 0 }],
          source: 'piped-hls',
        });
      }
    } catch (e) {
      lastError = String(e?.message || e);
    }
  }

  // Fallback: YouTube InnerTube. Only already-signed, combined browser URLs
  // are returned; cipher-only formats are deliberately not exposed.
  const clients = [
    { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'en', gl: 'IN' },
    { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.0.0', hl: 'en', gl: 'IN' },
    { clientName: 'WEB', clientVersion: '2.20250713.00.00', hl: 'en', gl: 'IN' },
  ];

  for (const client of clients) {
    try {
      const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': client.clientName === 'ANDROID'
            ? 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip'
            : 'Mozilla/5.0',
        },
        body: JSON.stringify({ videoId: id, context: { client }, contentCheckOk: true, racyCheckOk: true }),
      });
      if (!r.ok) { lastError = `Player request failed (${r.status})`; continue; }
      const data = await r.json();
      const vd = data.videoDetails || {};
      const sd = data.streamingData || {};
      if (!details && vd.videoId) {
        details = { id, title: vd.title || 'Video', channel: vd.author || '', duration: Number(vd.lengthSeconds || 0), thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, isLive: !!vd.isLiveContent };
      }
      const formats = [...(sd.formats || []), ...(sd.adaptiveFormats || [])]
        .filter(f => f?.url && /^video\/(mp4|webm)/i.test(String(f.mimeType || '')))
        .filter(f => String(f.mimeType || '').toLowerCase().includes('video') && (String(f.mimeType || '').toLowerCase().includes('audio') || !!f.audioQuality))
        .map(f => ({ url: f.url, quality: f.qualityLabel || f.quality || 'Auto', height: Number(f.height || 0), width: Number(f.width || 0), mimeType: String(f.mimeType).split(';')[0], bitrate: Number(f.bitrate || 0) }))
        .sort((a, b) => (b.height - a.height) || (b.bitrate - a.bitrate));
      if (formats.length) {
        res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
        return res.status(200).json({ video: details, formats, source: 'innertube' });
      }
    } catch (e) { lastError = String(e?.message || e); }
  }

  if (!details) return res.status(502).json({ error: lastError });
  return res.status(502).json({ error: 'No browser-playable stream is available right now.' });
}
