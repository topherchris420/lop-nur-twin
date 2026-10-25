"""Original deterministic piano, plucked strings, breathy synth and environmental score.
No samples or third-party music. Requires numpy, scipy, and ffmpeg.
"""
import json, subprocess
from pathlib import Path
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter,sosfilt
p=Path(__file__).parent;sr=48000;duration=58;n=sr*duration
rng=np.random.default_rng(20261025);music=np.zeros((n,2));voice=np.zeros(n)
def add(sound,start,amp=1,pan=0):
 i=int(start*sr);j=min(n,i+len(sound));s=sound[:j-i]*amp
 if i<0 or j<=i:return
 music[i:j,0]+=s*np.sqrt((1-pan)/2);music[i:j,1]+=s*np.sqrt((1+pan)/2)
def piano(freq,length=3):
 t=np.arange(int(sr*length))/sr
 x=sum((.65**(k-1)/k)*np.sin(2*np.pi*freq*k*t+.08*k)*np.exp(-t*(1.2+k*.3)) for k in range(1,7))
 return x*(1-np.exp(-t*180))*(1-np.exp(-(length-t)*30))
def flute(freq,length=1):
 t=np.arange(int(sr*length))/sr
 return (np.sin(2*np.pi*freq*t+.011*np.sin(2*np.pi*4*t))+.12*np.sin(4*np.pi*freq*t))*np.sin(np.pi*t/length)**2
# D major -> B minor -> G -> A -> D. Gentle 84-bpm pulse.
chords=[[146.832,220,293.665,369.994],[123.471,184.997,246.942,293.665],[97.999,146.832,195.998,246.942],[110,164.814,220,277.183]]
for beat in range(78):
 start=beat*60/84+.2;ci=min(3,(beat//8)%4);chord=chords[ci];freq=chord[[0,2,1,3,2,1,3,2][beat%8]]
 add(piano(freq*(2 if beat%4 else 1)),start,.085,(-.3 if beat%2 else .3))
 if beat%4==0:
  for f in chord[:3]:add(piano(f,5),start,.035,0)
# Quiet woodwind motif appears like curiosity, never competing with speech.
for start,f in [(6.9,739.99),(7.4,659.25),(14.6,587.33),(23.6,739.99),(31.5,659.25),(40.5,587.33),(49.7,440)]:add(flute(f,.7),start,.027,.4)
for f in [146.832,220,293.665,369.994,440]:add(piano(f,6),51.4,.065,-.1)
# Air, paper movement and brief wing flutters. No constant mosquito buzz.
air=sosfilt(butter(2,[220,1800],btype='bandpass',fs=sr,output='sos'),rng.normal(0,1,n))
add(air,0,.004,0)
for start in [0,7,15,24,32,41,50]:
 length=.35;t=np.arange(int(sr*length))/sr;noise=rng.normal(0,1,len(t));whoosh=sosfilt(butter(2,[450,4500],btype='bandpass',fs=sr,output='sos'),noise)*np.sin(np.pi*t/length)**2
 add(whoosh,start,.013,-.15)
for start in [3.5,10,15.4,29,53.3]:
 length=.5;t=np.arange(int(sr*length))/sr;buzz=(np.sin(2*np.pi*218*t)+.3*np.sin(2*np.pi*436*t))*np.sin(np.pi*t/length)**2
 add(buzz,start,.018,.3)
# Voice chunks are placed exactly at caption cue starts, with a small guard gap.
cues=json.loads((p/'cues.json').read_text())
for i,(start,end,text) in enumerate(cues):
 data=subprocess.check_output(['ffmpeg','-hide_banner','-loglevel','error','-i',str(p/f'voice-{i}.mp3'),'-f','f32le','-ac','1','-ar',str(sr),'-'])
 a=np.frombuffer(data,np.float32).copy();avail=end-start-.08
 if len(a)/sr>avail:
  data=subprocess.check_output(['ffmpeg','-hide_banner','-loglevel','error','-i',str(p/f'voice-{i}.mp3'),'-af',f'atempo={len(a)/sr/avail:.6f}','-f','f32le','-ac','1','-ar',str(sr),'-']);a=np.frombuffer(data,np.float32).copy()
 # Remove leading/trailing encoder silence from level assessment only.
 rms=np.sqrt(np.mean(a*a));a*=.125/max(rms,.001)
 offset=int(start*sr);voice[offset:offset+len(a)]+=a
 print(i,round(len(a)/sr,2),text)
# Warm room reflections and smooth voice-aware score ducking.
for delay,gain in [(.071,.17),(.113,.11),(.197,.07)]:
 d=int(delay*sr);music[d:]+=music[:-d]*gain
activity=sosfilt(butter(1,1.4,fs=sr,output='sos'),np.abs(voice));duck=1-.65*np.clip(activity*12,0,1)
music*=duck[:,None]
master=music+voice[:,None]*.9
fade=np.minimum(np.arange(n)/sr/1.1,(duration-np.arange(n)/sr)/2);master*=np.clip(fade,0,1)[:,None]
master=np.tanh(master*1.25);master*=.9/max(np.max(np.abs(master)),.9)
wavfile.write(p/'master.wav',sr,(master*32767).astype(np.int16))
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(p/'master.wav'),'-af','loudnorm=I=-16:TP=-1.5:LRA=9','-c:a','aac','-b:a','160k',str(p/'soundtrack.m4a')],check=True)
