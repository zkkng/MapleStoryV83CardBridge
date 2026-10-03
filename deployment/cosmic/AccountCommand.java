import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.*;
import java.util.HexFormat;
import java.util.UUID;
import tools.BCrypt;
import tools.DatabaseConnection;

/** Operator-only account provisioning; credentials arrive on stdin. */
public final class AccountCommand {
  public static void main(String[] args) throws Exception {
    byte[] raw = System.in.readNBytes(4097);
    if (raw.length > 4096) throw new IllegalArgumentException("Input too large");
    JsonObject input =
        JsonParser.parseString(new String(raw, StandardCharsets.UTF_8)).getAsJsonObject();
    String name = input.get("username").getAsString();
    if (!name.matches("[A-Za-z0-9]{3,13}"))
      throw new IllegalArgumentException("Invalid account name");
    if (!DatabaseConnection.initializeConnectionPool())
      throw new IllegalStateException("Database unavailable");
    try (Connection con = DatabaseConnection.getConnection()) {
      if ("create".equals(input.get("action").getAsString()))
        create(con, name, input.get("password").getAsString());
      else if ("fund".equals(input.get("action").getAsString())) fund(con, name, input);
      else throw new IllegalArgumentException("Unsupported operator action");
    }
    System.out.println("Operator account action completed.");
    System.exit(0);
  }

  private static void create(Connection con, String name, String password) throws SQLException {
    if (password.getBytes(StandardCharsets.UTF_8).length < 8
        || password.getBytes(StandardCharsets.UTF_8).length > 72)
      throw new IllegalArgumentException("Use 8 to 72 UTF-8 password bytes");
    try (PreparedStatement ps =
        con.prepareStatement(
            "INSERT INTO"
                + " accounts(name,password,tos,nxCredit,nxPrepaid,maplePoint,gender,characterslots,tempban)"
                + " VALUES(?,?,1,0,0,0,10,3,'2000-01-01 00:00:00') ON DUPLICATE KEY UPDATE"
                + " id=id")) {
      ps.setString(1, name);
      ps.setString(2, BCrypt.hashpw(password, BCrypt.gensalt(12)));
      ps.executeUpdate();
    }
    try (PreparedStatement ps =
        con.prepareStatement("SELECT password FROM accounts WHERE name=?")) {
      ps.setString(1, name);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()
            || !rs.getString(1).startsWith("$2")
            || !BCrypt.checkpw(password, rs.getString(1)))
          throw new IllegalStateException(
              "The account exists with different credentials; it was not changed");
      }
    }
  }

  private static void fund(Connection con, String name, JsonObject input) throws Exception {
    int type = input.get("cashType").getAsInt(), amount = input.get("amount").getAsInt();
    if (amount < 1 || amount > 100000000)
      throw new IllegalArgumentException("Invalid funding amount");
    String field =
        switch (type) {
          case 1 -> "nxCredit";
          case 2 -> "maplePoint";
          case 4 -> "nxPrepaid";
          default -> throw new IllegalArgumentException("Invalid cash type");
        };
    String key = input.has("key") ? input.get("key").getAsString() : UUID.randomUUID().toString();
    if (!key.matches("[A-Za-z0-9._:-]{1,128}"))
      throw new IllegalArgumentException("Invalid funding request ID");
    try (Statement st = con.createStatement()) {
      st.execute(
          "CREATE TABLE IF NOT EXISTS card_bridge_operator_funding(request_id CHAR(64) PRIMARY"
              + " KEY,account_id INT NOT NULL,cash_type INT NOT NULL,amount INT NOT"
              + " NULL,balance_after INT NOT NULL,created_at TIMESTAMP NOT NULL DEFAULT"
              + " CURRENT_TIMESTAMP) ENGINE=InnoDB");
    }
    con.setAutoCommit(false);
    try {
      int account, balance;
      try (PreparedStatement ps =
          con.prepareStatement(
              "SELECT id,COALESCE(" + field + ",0) FROM accounts WHERE name=? FOR UPDATE")) {
        ps.setString(1, name);
        try (ResultSet rs = ps.executeQuery()) {
          if (!rs.next()) throw new IllegalStateException("Account unavailable");
          account = rs.getInt(1);
          balance = rs.getInt(2);
        }
      }
      String request =
          HexFormat.of()
              .formatHex(
                  MessageDigest.getInstance("SHA-256")
                      .digest(
                          ("operator-fund\n" + account + "\n" + key)
                              .getBytes(StandardCharsets.UTF_8)));
      try (PreparedStatement ps =
          con.prepareStatement(
              "SELECT account_id,cash_type,amount FROM card_bridge_operator_funding WHERE"
                  + " request_id=?")) {
        ps.setString(1, request);
        try (ResultSet rs = ps.executeQuery()) {
          if (rs.next()) {
            if (rs.getInt(1) != account || rs.getInt(2) != type || rs.getInt(3) != amount)
              throw new IllegalStateException("Funding request ID has different terms");
            con.commit();
            return;
          }
        }
      }
      if (balance < 0 || (long) balance + amount > Integer.MAX_VALUE)
        throw new IllegalStateException("Balance unavailable");
      try (PreparedStatement ps =
          con.prepareStatement("UPDATE accounts SET " + field + "=? WHERE id=?")) {
        ps.setInt(1, balance + amount);
        ps.setInt(2, account);
        ps.executeUpdate();
      }
      try (PreparedStatement ps =
          con.prepareStatement(
              "INSERT INTO"
                  + " card_bridge_operator_funding(request_id,account_id,cash_type,amount,balance_after)"
                  + " VALUES(?,?,?,?,?)")) {
        ps.setString(1, request);
        ps.setInt(2, account);
        ps.setInt(3, type);
        ps.setInt(4, amount);
        ps.setInt(5, balance + amount);
        ps.executeUpdate();
      }
      con.commit();
    } catch (Exception error) {
      con.rollback();
      throw error;
    } finally {
      con.setAutoCommit(true);
    }
  }
}
