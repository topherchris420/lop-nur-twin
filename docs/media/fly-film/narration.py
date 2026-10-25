"""Generate the disclosed synthetic documentary voice (requires edge-tts).
Uses system CA roots, including any configured enterprise proxy certificates.
"""
import asyncio,json,ssl
from pathlib import Path
import edge_tts
import edge_tts.communicate as comm
comm._SSL_CTX=ssl.create_default_context()
if Path('/etc/ssl/certs/ca-certificates.crt').exists():
 comm._SSL_CTX.load_verify_locations('/etc/ssl/certs/ca-certificates.crt')
p=Path(__file__).parent
async def main():
 for i,(_,_,text) in enumerate(json.loads((p/'cues.json').read_text())):
  dest=p/f'voice-{i}.mp3'
  if not dest.exists():
   await edge_tts.Communicate(text.replace('Vers3Dynamics','Verse Dynamics'),'en-GB-RyanNeural',rate='-6%').save(str(dest))
  print(dest.name,flush=True)
asyncio.run(main())
