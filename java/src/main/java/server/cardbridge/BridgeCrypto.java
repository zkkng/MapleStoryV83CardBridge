package server.cardbridge;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class BridgeCrypto {
  static final long MAX_SKEW_MILLIS = 60000;
  static final int MAX_NONCES = 10000;

  private BridgeCrypto() {}

  public static String sha(String value) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  public static String hmac(String secret, String value) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  public static String signature(
      String secret, String method, String path, String time, String nonce, String body) {
    return hmac(secret, String.join("\n", method, path, time, nonce, sha(body)));
  }

  public static boolean verify(
      String secret,
      String method,
      String path,
      String time,
      String nonce,
      String signature,
      String body,
      ConcurrentHashMap<String, Long> used,
      long now) {
    if (time == null
        || !time.matches("[0-9]{13}")
        || Math.abs(now - Long.parseLong(time)) > MAX_SKEW_MILLIS
        || nonce == null
        || !nonce.matches("[a-f0-9]{32}")
        || signature == null
        || !signature.matches("[a-f0-9]{64}")) return false;
    String wanted = signature(secret, method, path, time, nonce, body);
    if (!MessageDigest.isEqual(
        wanted.getBytes(StandardCharsets.US_ASCII), signature.getBytes(StandardCharsets.US_ASCII)))
      return false;
    // A future-dated request stays valid longer than one skew interval after receipt.
    // Keep its nonce through the inclusive final signature-validity boundary.
    long expiresAt = Long.parseLong(time) + MAX_SKEW_MILLIS;
    synchronized (used) {
      used.entrySet().removeIf(e -> e.getValue() < now);
      return used.size() < MAX_NONCES && used.putIfAbsent(nonce, expiresAt) == null;
    }
  }
}
