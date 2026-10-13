import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { addBaseMap } from './baseMap.js';
import { computeProgress, indexCities } from './cityProgress.js';
export default function ConquestMap({ photos }) {
  const host = useRef(null), mapRef=useRef(null), citiesLayer=useRef(null);
  const [dataset,setDataset]=useState(null), [error,setError]=useState(''), [retry,setRetry]=useState(0);
  const [prefecture,setPrefecture]=useState(''), [selection,setSelection]=useState(null);
  useEffect(() => {
    const abort = new AbortController();
    setError('');
    fetch(import.meta.env.BASE_URL+'city-boundaries.json',{signal:abort.signal}).then(response => {
      if (!response.ok) throw new Error('行政区域データを取得できませんでした。');
      return response.json();
    }).then(value => {
      if (!value.features?.length) throw new Error('行政区域データが不正です。');
      setDataset(value);
    }).catch(e => { if(e.name!=='AbortError')setError(e.message); });
    return ()=>abort.abort();
  },[retry]);
  const index=useMemo(()=>dataset?indexCities(dataset):[],[dataset]);
  const progress=useMemo(()=>computeProgress(index,photos),[index,photos]);
  const prefectures=useMemo(()=>[...new Set(index.map(c=>c.feature.properties.prefecture))],[index]);
  const visibleCities=useMemo(()=>index.filter(c=>!prefecture||c.feature.properties.prefecture===prefecture),[index,prefecture]);
  const completedVisible=visibleCities.filter(c=>progress.completed.has(c.feature.properties.code)).length;
  useEffect(()=>{
    const map=L.map(host.current,{preferCanvas:true}).setView([37,137],5);
    mapRef.current=map;
    addBaseMap(map, { attribution: ' · <a href="https://nlftp.mlit.go.jp/ksj/">国土数値情報（加工）</a>' });
    const resize=new ResizeObserver(()=>map.invalidateSize());resize.observe(host.current);
    return()=>{resize.disconnect();map.remove();mapRef.current=null;};
  },[]);
  useEffect(()=>{
    if(!dataset)return;
    const layer=L.geoJSON({type:'FeatureCollection',features:visibleCities.map(c=>c.feature)},{
      style:feature=>({color:progress.completed.has(feature.properties.code)?'#11765f':'#98afa6',weight:1,fillColor:progress.completed.has(feature.properties.code)?'#24ae82':'#e4ece7',fillOpacity:progress.completed.has(feature.properties.code)?.55:.15}),
      onEachFeature(feature,polygon){
        polygon.on('click',()=>setSelection(feature.properties));
        polygon.bindTooltip(feature.properties.name);
      },
    }).addTo(mapRef.current);
    citiesLayer.current=layer;
    if(prefecture&&layer.getBounds().isValid())mapRef.current.fitBounds(layer.getBounds(),{padding:[15,15],maxZoom:10});
    return()=>{layer.remove();citiesLayer.current=null;};
  },[dataset,visibleCities,progress,prefecture]);
  const entry=selection?progress.completed.get(selection.code):null;
  return <section className="conquest-view" aria-label="全国の市の攻略マップ">
    <div className="conquest-summary"><div><span className="eyebrow">CITY QUEST</span><h2>全国の市を、旅して埋めよう。</h2></div>
      <strong>{dataset?progress.completed.size:'—'} <small>/ {index.length||'—'} 市</small></strong>
      <progress value={progress.completed.size} max={index.length||1} aria-label="全国の攻略率" />
      <span>{index.length?((progress.completed.size/index.length)*100).toFixed(1):'0'}% コンプリート</span>
    </div>
    <div className="conquest-tools"><label>都道府県<select value={prefecture} onChange={e=>{setPrefecture(e.target.value);setSelection(null);}}><option value="">全国</option>{prefectures.map(p=><option key={p}>{p}</option>)}</select></label>
      <button onClick={()=>{setPrefecture('');mapRef.current.setView([37,137],5);}}>全国を表示</button>
      <span className="conquest-legend"><i />攻略済み <i className="unvisited" />未攻略</span>
    </div>
    <div className="conquest-map-wrap"><div ref={host} className="conquest-map" />
      {!dataset&&!error&&<p className="conquest-loading" role="status">全国の市を読み込んでいます…</p>}
      {error&&<div className="conquest-loading" role="alert">{error}<button onClick={()=>setRetry(n=>n+1)}>再読み込み</button></div>}
      {selection&&<div className="conquest-city"><button className="conquest-close" aria-label="市の詳細を閉じる" onClick={()=>setSelection(null)}>×</button><small>{selection.prefecture}</small><h3>{selection.name}</h3>
        <strong>{entry?'✓ コンプリート':'まだ訪れていません'}</strong><p>{entry?entry.photos.length+'枚の写真があります。':'この市で写真を保存すると攻略済みになります。'}</p>
        {entry&&<p>最初の記録：{new Date(Math.min(...entry.photos.map(p=>p.createdAt))).toLocaleDateString('ja-JP')}</p>}
      </div>}
    </div>
    <div className="conquest-footer"><span>{prefecture||'全国'}：{completedVisible} / {visibleCities.length} 市</span>
      <p>自分の保存写真の撮影場所から判定します。町・村・東京23区は対象外。政令指定都市は市全体で1つです。</p>
      <p>境界は2021年の行政区域データを簡略化したものです。境界付近や海岸では判定できない場合があります。{dataset&&progress.unmatched>0? '市として判定されなかった写真：'+progress.unmatched+'枚。':''}</p>
    </div>
  </section>;
}
