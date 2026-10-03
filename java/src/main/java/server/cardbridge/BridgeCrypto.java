package server.cardbridge;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class BridgeCrypto {
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
        || Math.abs(now - Long.parseLong(time)) > 60000
        || nonce == null
        || !nonce.matches("[a-f0-9]{32}")
        || signature == null
        || !signature.matches("[a-f0-9]{64}")) return false;
    String wanted = signature(secret, method, path, time, nonce, body);
    if (!MessageDigest.isEqual(
        wanted.getBytes(StandardCharsets.US_ASCII), signature.getBytes(StandardCharsets.US_ASCII)))
      return false;
    used.entrySet().removeIf(e -> e.getValue() < now - 60000);
    return used.size() < 10000 && used.putIfAbsent(nonce, now) == null;
  }
}
