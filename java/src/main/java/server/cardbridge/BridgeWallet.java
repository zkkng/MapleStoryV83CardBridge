package server.cardbridge;

import java.sql.*;
import java.util.*;
import tools.DatabaseConnection;

/** Database authority prevents character saves from overwriting website debits. */
public final class BridgeWallet {
  private BridgeWallet() {}

  private static String column(int type) {
    return switch (type) {
      case 1 -> "nxCredit";
      case 2 -> "maplePoint";
      case 4 -> "nxPrepaid";
      default -> throw new IllegalArgumentException("Unknown cash type");
    };
  }

  public static int read(int accountId, int type) {
    try (Connection con = DatabaseConnection.getConnection();
        PreparedStatement ps =
            con.prepareStatement("SELECT " + column(type) + " FROM accounts WHERE id=?")) {
      ps.setInt(1, accountId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) throw new IllegalStateException("Account unavailable");
        return rs.getInt(1);
      }
    } catch (SQLException e) {
      throw new IllegalStateException("Cash balance unavailable", e);
    }
  }

  public static void change(int accountId, int type, int delta) {
    String name = column(type);
    try (Connection con = DatabaseConnection.getConnection();
        PreparedStatement ps =
            con.prepareStatement(
                "UPDATE accounts SET "
                    + name
                    + "="
                    + name
                    + "+? WHERE id=? AND "
                    + name
                    + "+? BETWEEN 0 AND 2147483647")) {
      ps.setInt(1, delta);
      ps.setInt(2, accountId);
      ps.setInt(3, delta);
      if (ps.executeUpdate() != 1) throw new IllegalStateException("Cash change rejected");
    } catch (SQLException e) {
      throw new IllegalStateException("Cash change unavailable", e);
    }
  }

  public static List<Integer> acceptedTypes() {
    String value = System.getenv().getOrDefault("CARD_BRIDGE_ACCEPTED_CASH_TYPES", "1,2,4");
    List<Integer> types =
        Arrays.stream(value.split(",")).map(String::trim).map(Integer::parseInt).toList();
    if (types.isEmpty()
        || types.stream().anyMatch(t -> !Set.of(1, 2, 4).contains(t))
        || new HashSet<>(types).size() != types.size())
      throw new IllegalStateException("Invalid accepted cash types");
    return types;
  }

  public static Map<String, Object> wallet(int account) throws SQLException {
    try (Connection con = DatabaseConnection.getConnection();
        PreparedStatement ps =
            con.prepareStatement(
                "SELECT COALESCE(nxCredit,0),COALESCE(maplePoint,0),COALESCE(nxPrepaid,0) FROM"
                    + " accounts WHERE id=? AND banned=0 AND tempban<=UTC_TIMESTAMP()")) {
      ps.setInt(1, account);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next())
          throw new BridgeHttp.Problem(401, "ACCOUNT_UNAVAILABLE", "The account is unavailable.");
        return Map.of(
            "nx",
            rs.getInt(1),
            "acceptedCashTypes",
            acceptedTypes(),
            "balances",
            List.of(
                Map.of("cashType", 1, "name", "NX Credit", "amount", rs.getInt(1)),
                Map.of("cashType", 2, "name", "Maple Points", "amount", rs.getInt(2)),
                Map.of("cashType", 4, "name", "NX Prepaid", "amount", rs.getInt(3))));
      }
    }
  }

  public static Map<String, Object> debit(String orderId, int accountId, int amount)
      throws SQLException {
    return debit(orderId, accountId, amount, 1);
  }

  public static Map<String, Object> debit(String orderId, int accountId, int amount, int cashType)
      throws SQLException {
    String name = column(cashType);
    if (!orderId.matches("[a-f0-9]{64}") || accountId < 1 || amount < 1 || amount > 100000000)
      throw new IllegalArgumentException("Invalid debit");
    try (Connection con = DatabaseConnection.getConnection()) {
      con.setAutoCommit(false);
      try {
        try (PreparedStatement ps =
            con.prepareStatement(
                "SELECT account_id,amount,balance_after,cash_type FROM card_bridge_payments WHERE"
                    + " order_id=? FOR UPDATE")) {
          ps.setString(1, orderId);
          try (ResultSet rs = ps.executeQuery()) {
            if (rs.next()) {
              if (rs.getInt(1) != accountId || rs.getInt(2) != amount || rs.getInt(4) != cashType)
                throw new IllegalArgumentException("Payment identity conflict");
              var result =
                  Map.<String, Object>of(
                      "orderId",
                      orderId,
                      "accountId",
                      accountId,
                      "amount",
                      amount,
                      "balance",
                      rs.getInt(3),
                      "cashType",
                      cashType);
              con.commit();
              return result;
            }
          }
        }
        if (!acceptedTypes().contains(cashType))
          throw new BridgeHttp.Problem(
              400, "UNSUPPORTED_CASH_TYPE", "This cash type is not accepted.");
        try (PreparedStatement ps =
            con.prepareStatement(
                "UPDATE accounts SET "
                    + name
                    + "=COALESCE("
                    + name
                    + ",0)-? WHERE id=? AND banned=0 AND tempban<=UTC_TIMESTAMP() AND COALESCE("
                    + name
                    + ",0)>=?")) {
          ps.setInt(1, amount);
          ps.setInt(2, accountId);
          ps.setInt(3, amount);
          if (ps.executeUpdate() != 1)
            throw new BridgeHttp.Problem(
                409,
                "INSUFFICIENT_FUNDS",
                "There is not enough of the selected balance for this pack.");
        }
        int balance;
        try (PreparedStatement ps =
            con.prepareStatement("SELECT " + name + " FROM accounts WHERE id=?")) {
          ps.setInt(1, accountId);
          try (ResultSet rs = ps.executeQuery()) {
            rs.next();
            balance = rs.getInt(1);
          }
        }
        try (PreparedStatement ps =
            con.prepareStatement(
                "INSERT INTO"
                    + " card_bridge_payments(order_id,account_id,amount,balance_after,cash_type)"
                    + " VALUES(?,?,?,?,?)")) {
          ps.setString(1, orderId);
          ps.setInt(2, accountId);
          ps.setInt(3, amount);
          ps.setInt(4, balance);
          ps.setInt(5, cashType);
          ps.executeUpdate();
        }
        con.commit();
        return Map.of(
            "orderId",
            orderId,
            "accountId",
            accountId,
            "amount",
            amount,
            "balance",
            balance,
            "cashType",
            cashType);
      } catch (Exception e) {
        con.rollback();
        throw e;
      } finally {
        con.setAutoCommit(true);
      }
    }
  }
}
