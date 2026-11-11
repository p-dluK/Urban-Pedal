// --- FUNCIONALIDADE DE BLOQUEIO DE TELA (ANTI-TOQUE) ---
let unlockCounter = 0;
document.getElementById('lockScreenBtn').onclick = () => {
  document.getElementById('screenLockOverlay').hidden = false;
  unlockCounter = 0;
};

document.getElementById('unlockScreenBtn').onclick = () => {
  unlockCounter++;
  if (unlockCounter >= 3) {
    document.getElementById('screenLockOverlay').hidden = true;
    unlockCounter = 0;
    status('Tela desbloqueada.');
  }
};


// --- PAINEL DE ESTATÍSTICAS E MÉTRICAS ---
let currentStatsTab = 'day'; // 'day' ou 'week'

document.getElementById('statsToggleBtn').onclick = () => {
  renderStatsPanel();
  document.getElementById('statsPanel').hidden = false;
};

document.getElementById('closeStats').onclick = () => {
  document.getElementById('statsPanel').hidden = true;
};

document.getElementById('tabDay').onclick = () => {
  currentStatsTab = 'day';
  document.getElementById('tabDay').classList.add('active');
  document.getElementById('tabWeek').classList.remove('active');
  renderStatsPanel();
};

document.getElementById('tabWeek').onclick = () => {
  currentStatsTab = 'week';
  document.getElementById('tabWeek').classList.add('active');
  document.getElementById('tabDay').classList.remove('active');
  renderStatsPanel();
};

function renderStatsPanel() {
  const container = document.getElementById('statsContent');
  const rides = readStore(rideStoreKey, []);
  
  if (!rides.length) {
    container.innerHTML = '<p style="text-align:center; color:#65736d; padding:20px;">Nenhuma pedalada registrada para calcular estatísticas.</p>';
    return;
  }

  // Agrupamento por Dia ou por Semana
  const groups = {};
  
  rides.forEach(r => {
    const d = new Date(r.date);
    let key = '';
    if (currentStatsTab === 'day') {
      key = d.toLocaleDateString('pt-BR');
    } else {
      // Agrupa por número da semana no ano
      const onejan = new Date(d.getFullYear(), 0, 1);
      const weekNum = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
      key = `Semana ${weekNum} / ${d.getFullYear()}`;
    }

    if (!groups[key]) {
      groups[key] = { totalKm: 0, totalMs: 0, totalMoney: 0, totalDeliveries: 0, hoursMap: {} };
    }

    groups[key].totalKm += (r.distance || 0) / 1000;
    groups[key].totalMs += (r.duration || 0);

    const deliveries = r.deliveries || [];
    deliveries.forEach(del => {
      const val = Number(del.value);
      if (Number.isFinite(val) && val > 0) {
        groups[key].totalMoney += val;
        groups[key].totalDeliveries += 1;

        // Hora do dia em que a entrega foi aceita ou concluída
        const timeRef = del.accepted ? new Date(del.accepted.time) : d;
        const hour = timeRef.getHours();
        groups[key].hoursMap[hour] = (groups[key].hoursMap[hour] || 0) + val;
      }
    });
  });

  let html = '';
  Object.keys(groups).forEach(period => {
    const g = groups[period];
    const avgKm = g.totalKm > 0 ? (g.totalMoney / g.totalKm).toFixed(2) : '0,00';
    const avgDel = g.totalDeliveries > 0 ? (g.totalMoney / g.totalDeliveries).toFixed(2) : '0,00';
    const totalHours = g.totalMs > 0 ? g.totalMs / 3600000 : 0;
    const avgHour = totalHours > 0 ? (g.totalMoney / totalHours).toFixed(2) : '0,00';
    
    // Encontrar a melhor hora do dia (com maior ganho)
    let bestHour = '—';
    let maxHourVal = -1;
    Object.keys(g.hoursMap).forEach(h => {
      if (g.hoursMap[h] > maxHourVal) {
        maxHourVal = g.hoursMap[h];
        bestHour = `${h}:00 - ${Number(h)+1}:00`;
      }
    });

    html += `
      <div class="stat-card-item">
        <strong style="font-size:13px; color:#102d25; border-bottom:1px solid #d4e8d8; padding-bottom:4px; display:block;">📅 ${period}</strong>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-top:8px;">
          <div><small>Faturamento Total</small><b>R$ ${g.totalMoney.toFixed(2).replace('.',',')}</b></div>
          <div><small>Média por KM</small><b>R$ ${avgKm.replace('.',',')} / km</b></div>
          <div><small>Média por Entrega</small><b>R$ ${avgDel.replace('.',',')} / ped.</b></div>
          <div><small>Média por Hora</small><b>R$ ${avgHour.replace('.',',')} / h</b></div>
        </div>
        <div style="margin-top:8px; border-top:1px dashed #d4e8d8; padding-top:6px;">
          <small>⚡ Horário mais lucrativo: <b>${bestHour}</b></small>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}