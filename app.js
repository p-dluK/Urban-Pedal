function setRideControls() {
  const active = rideActive;
  document.getElementById('startStateWrap').hidden = active;
  document.getElementById('activeStateWrap').hidden = !active;

  const pauseBtn = document.getElementById('pauseRideBtn');
  if (pauseBtn) {
    pauseBtn.textContent = ridePaused ? '▶' : 'Ⅱ';
    pauseBtn.setAttribute('aria-label', ridePaused ? 'Retomar' : 'Pausar');
  }

  updateDeliveryStepState();
  updateRideHud();
}