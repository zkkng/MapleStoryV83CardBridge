package server.cardbridge;

import java.util.Map;

public final class SeriesOne {
  private SeriesOne() {}

  public record Reward(int quantity, int petDays, String prefix) {}

  public static final Map<Integer, Reward> REWARDS =
      Map.ofEntries(
          Map.entry(4031750, new Reward(1, 0, "")),
          Map.entry(4031751, new Reward(1, 0, "")),
          Map.entry(4031752, new Reward(1, 0, "")),
          Map.entry(4031753, new Reward(1, 0, "")),
          Map.entry(4031754, new Reward(1, 0, "")),
          Map.entry(4031755, new Reward(1, 0, "")),
          Map.entry(4031756, new Reward(1, 0, "")),
          Map.entry(4031757, new Reward(1, 0, "")),
          Map.entry(4031758, new Reward(1, 0, "")),
          Map.entry(4031759, new Reward(1, 0, "")),
          Map.entry(4031760, new Reward(1, 0, "")),
          Map.entry(2000005, new Reward(10, 0, "")),
          Map.entry(2002023, new Reward(10, 0, "")),
          Map.entry(2022121, new Reward(2, 0, "")),
          Map.entry(5000034, new Reward(1, 30, "C01")),
          Map.entry(5000037, new Reward(1, 30, "C02")),
          Map.entry(5000039, new Reward(1, 30, "C03")));

  public static String normalize(String code) {
    if (code == null || code.length() > 40) throw new IllegalArgumentException("Invalid code");
    String value = code.replace(" ", "").replace("-", "").toUpperCase(java.util.Locale.ROOT);
    if (!value.matches("(?:[A-Z2-9]{15}|C0[123][A-Z2-9]{15})"))
      throw new IllegalArgumentException("Invalid code");
    return value;
  }

  public static void validate(String code, int item, int quantity, int petDays, int series) {
    Reward r = REWARDS.get(item);
    if (series != 1 || r == null || r.quantity() != quantity || r.petDays() != petDays)
      throw new IllegalArgumentException("Unsupported Series One reward");
    String normal = normalize(code);
    if (!normal.matches(r.prefix() + "[A-Z2-9]{15}"))
      throw new IllegalArgumentException("Incorrect reward code pattern");
  }
}
