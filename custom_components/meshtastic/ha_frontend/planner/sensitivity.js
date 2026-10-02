// Czułość odbiornika LoRa — port Sensitivity.kt.

/** Graniczne SNR demodulatora (dB) dla SF 5..12. */
export function snrLimitDb(sf) {
  switch (sf) {
    case 5: return -2.5;
    case 6: return -5.0;
    case 7: return -7.5;
    case 8: return -10.0;
    case 9: return -12.5;
    case 10: return -15.0;
    case 11: return -17.5;
    case 12: return -20.0;
    default: return sf < 5 ? -2.5 : -20.0;
  }
}

/** Czułość w dBm: -174 + 10 log10(BW Hz) + NF + SNR_lim. */
export function sensitivityDbm(bwKhz, sf, nfDb) {
  return -174.0 + 10.0 * Math.log10(bwKhz * 1000.0) + nfDb + snrLimitDb(sf);
}
