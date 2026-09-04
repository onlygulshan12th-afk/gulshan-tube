export default async function handler(req, res) {
  const id = String(req.query.videoId || '').trim();
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid video id' });
  }

  const clients = [
    {
      clientName: 'ANDROID',
      clientVersion: '20.10.38',
      androidSdkVersion: 34,
      hl: 'en',
      gl: 'IN',
    },
    {
      clientName: 'IOS',
      clientVersion: '20.10.4',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.3.2.0.0',
      hl: 'en',
      gl: 'IN',
    },
    {
      clientName: 'WEB',
      clientVersion: '2.20250713.00.00',
      hl: 'en',
      gl: 'IN',
    },
  ];

  let lastError = 'No playable stream found';
  const allFormats = [];
  let details = null;

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
        body: JSON.stringify({
          videoId: id,
          context: { client },
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      if (!r.ok) {
        lastError = `Player request failed (${r.status})`;
        continue;
      }

      const data = await r.json();
      const vd = data.videoDetails || {};
      const sd = data.streamingData || {};
      if (!details && vd.videoId) {
        details = {
          id,
          title: vd.title || 'Video',
          channel: vd.author || '',
          duration: Number(vd.lengthSeconds || 0),
          thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          isLive: !!vd.isLiveContent,
        };
      }

      const formats = [...(sd.formats || []), ...(sd.adaptiveFormats || [])];
      for (const f of formats) {
        // Only return direct, already-signed URLs. Cipher-only formats require
        // YouTube's player-JS signature deciphering and are intentionally skipped.
        if (!f.url || !f.mimeType) continue;
        const mime = String(f.mimeType).toLowerCase();
        const hasVideo = mime.includes('video');
        const hasAudio = mime.includes('audio') || mime.includes('mp4a') || !!f.audioQuality;
        if (!hasVideo || !hasAudio) continue;
        if (!/^video\/(mp4|webm)/.test(mime)) continue;
        allFormats.push({
          url: f.url,
          quality: f.qualityLabel || f.quality || 'Auto',
          height: Number(f.height || 0),
          width: Number(f.width || 0),
          mimeType: mime.split(';')[0],
          bitrate: Number(f.bitrate || 0),
        });
      }
      if (allFormats.length >= 2) break;
    } catch (e) {
      lastError = String(e?.message || e);
    }
  }

  const seen = new Set();
  const formats = allFormats
    .filter(f => !seen.has(f.url) && seen.add(f.url))
    .sort((a, b) => (b.height - a.height) || (b.bitrate - a.bitrate));

  if (!details) return res.status(502).json({ error: lastError });

  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  return res.status(200).json({ video: details, formats });
}
