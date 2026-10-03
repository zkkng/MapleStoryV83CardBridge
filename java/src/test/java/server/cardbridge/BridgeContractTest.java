package server.cardbridge;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import client.Character;
import client.Client;
import client.inventory.*;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import server.CashShop;
import server.ItemInformationProvider;
import tools.DatabaseConnection;
import tools.PacketCreator;

public class BridgeContractTest {
  public static Timestamp utcNow() {
    return Timestamp.from(java.time.Instant.now());
  }

  static final String CODE = "BBBBBBBBBBBBBBB", ID = "11111111-2222-4333-8444-555555555555";

  static class Fixture implements AutoCloseable {
    final String url = "jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=MySQL;DB_CLOSE_DELAY=-1";
    final MockedStatic<DatabaseConnection> db = mockStatic(DatabaseConnection.class);
    final MockedStatic<BridgeHttp> transport = mockStatic(BridgeHttp.class);
    MockedStatic<ItemInformationProvider> information;
    final MockedStatic<PacketCreator> packets = mockStatic(PacketCreator.class);
    ItemInformationProvider items;
    final Character chr = mock(Character.class);
    final Client client = mock(Client.class);
    final Inventory inventory = new Inventory(chr, InventoryType.ETC, (byte) 16);
    final CashShop cashShop = mock(CashShop.class);
    final List<Item> cashInventory = new ArrayList<>();
    boolean failSave;

    Fixture() throws Exception {
      db.when(DatabaseConnection::getConnection).thenAnswer(i -> connection());
      transport.when(BridgeHttp::enabled).thenReturn(true);
      transport.when(BridgeHttp::codeKey).thenReturn("test-code-index-key-".repeat(3));

      when(client.getPlayer()).thenReturn(chr);
      when(client.getAccID()).thenReturn(1);
      when(chr.getCashShop()).thenReturn(cashShop);
      when(cashShop.getItemsSize()).thenAnswer(i -> cashInventory.size());
      doAnswer(
              i -> {
                cashInventory.add(i.getArgument(0));
                return null;
              })
          .when(cashShop)
          .addToInventory(any());
      when(chr.getId()).thenReturn(7);
      when(chr.getClient()).thenReturn(client);
      when(chr.getInventory(any())).thenReturn(inventory);
      try (Connection con = connection();
          Statement st = con.createStatement()) {
        st.execute("CREATE ALIAS UTC_TIMESTAMP FOR 'server.cardbridge.BridgeContractTest.utcNow'");
        st.execute(
            "CREATE TABLE accounts(id INT PRIMARY KEY,name VARCHAR(13),password"
                + " VARCHAR(128),nxCredit INT,maplePoint INT,nxPrepaid INT,banned INT,tempban"
                + " TIMESTAMP)");
        st.execute(
            "INSERT INTO accounts VALUES(1,'Collector','password',10000,0,0,0,TIMESTAMP '1970-01-01"
                + " 00:00:00')");
        st.execute("CREATE TABLE saved_items(id INT PRIMARY KEY,quantity INT)");
        st.execute("CREATE TABLE saved_cash_items(item_id INT PRIMARY KEY,expiration BIGINT)");
        st.execute("CREATE TABLE monstercarddata(id INT,cardid INT,mobid INT)");
        String schema =
            new String(
                BridgeContractTest.class
                    .getResourceAsStream("/card-bridge/schema.sql")
                    .readAllBytes(),
                StandardCharsets.UTF_8);
        for (String sql : schema.split(";")) if (!sql.isBlank()) st.execute(sql);
      }
      information = mockStatic(ItemInformationProvider.class);
      items = mock(ItemInformationProvider.class);
      information.when(ItemInformationProvider::getInstance).thenReturn(items);
      when(items.getName(anyInt())).thenReturn("Series One reward");
      doAnswer(
              i -> {
                try (Connection con = connection()) {
                  con.setAutoCommit(false);
                  try {
                    try (Statement st = con.createStatement()) {
                      st.execute("DELETE FROM saved_items");
                    }
                    for (Item item : inventory.list())
                      try (PreparedStatement ps =
                          con.prepareStatement("INSERT INTO saved_items VALUES(?,?)")) {
                        ps.setInt(1, item.getPosition());
                        ps.setInt(2, item.getQuantity());
                        ps.executeUpdate();
                      }
                    try (Statement st = con.createStatement()) {
                      st.execute("DELETE FROM saved_cash_items");
                    }
                    for (Item item : cashInventory)
                      try (PreparedStatement ps =
                          con.prepareStatement("INSERT INTO saved_cash_items VALUES(?,?)")) {
                        ps.setInt(1, item.getItemId());
                        ps.setLong(2, item.getExpiration());
                        ps.executeUpdate();
                      }
                    BridgeRewards.beforeSave(con, chr);
                    if (failSave) throw new SQLException("Injected inventory commit failure");
                    con.commit();
                    BridgeRewards.afterSave(chr);
                  } catch (Exception e) {
                    con.rollback();
                  }
                }
                return null;
              })
          .when(chr)
          .saveCharToDB(true);
    }

    Connection connection() throws SQLException {
      return DriverManager.getConnection(url);
    }

    int scalar(String sql) throws SQLException {
      try (Connection c = connection();
          Statement st = c.createStatement();
          ResultSet rs = st.executeQuery(sql)) {
        rs.next();
        return rs.getInt(1);
      }
    }

    void register() throws Exception {
      BridgeRewards.register(ID, 1, CODE, 4031757, 1, 0, 1);
    }

    public void close() throws Exception {
      var field = BridgeRewards.class.getDeclaredField("pending");
      field.setAccessible(true);
      ((Map<?, ?>) field.get(null)).clear();
      packets.close();
      information.close();
      transport.close();
      db.close();
    }
  }

  @Test
  void seriesOneRejectsOtherSeriesAndWrongPetPrefixes() {
    assertEquals(17, SeriesOne.REWARDS.size());
    SeriesOne.validate("C01" + CODE, 5000034, 1, 30, 1);
    assertThrows(
        IllegalArgumentException.class, () -> SeriesOne.validate("C02" + CODE, 5000034, 1, 30, 1));
    assertThrows(IllegalArgumentException.class, () -> SeriesOne.validate(CODE, 4031757, 1, 0, 2));
    assertThrows(IllegalArgumentException.class, () -> SeriesOne.validate(CODE, 2000005, 1, 0, 1));
    assertEquals(CODE, SeriesOne.normalize("bbbbb bbbbb-bbbbb"));
  }

  @Test
  void exactBodyAndPathAreAuthenticatedAndNoncesCannotReplay() {
    String secret = "test-shared-key-".repeat(4),
        time = "1790942400000",
        nonce = "a".repeat(32),
        body = "{\"example\":1}",
        path = "/codes/register";
    String signature = BridgeCrypto.signature(secret, "POST", path, time, nonce, body);
    var used = new ConcurrentHashMap<String, Long>();
    assertTrue(
        BridgeCrypto.verify(
            secret, "POST", path, time, nonce, signature, body, used, Long.parseLong(time)));
    assertFalse(
        BridgeCrypto.verify(
            secret, "POST", path, time, nonce, signature, body, used, Long.parseLong(time)));
    assertFalse(
        BridgeCrypto.verify(
            secret,
            "POST",
            "/debit",
            time,
            nonce,
            signature,
            body,
            new ConcurrentHashMap<>(),
            Long.parseLong(time)));
    assertFalse(
        BridgeCrypto.verify(
            secret,
            "POST",
            path,
            time,
            nonce,
            signature,
            body + " ",
            new ConcurrentHashMap<>(),
            Long.parseLong(time)));
  }

  @Test
  void rewardItemAndUsedOutboxCommitTogetherAndCannotBeGrantedTwice() throws Exception {
    try (Fixture f = new Fixture()) {
      f.register();
      assertTrue(BridgeRewards.handle(f.client, CODE));
      assertEquals("USED", BridgeRewards.status(ID).get("status"));
      assertEquals(1, f.inventory.list().size());
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM saved_items"));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM card_bridge_outbox"));
      assertTrue(BridgeRewards.handle(f.client, CODE));
      assertEquals(1, f.inventory.list().size());
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM card_bridge_outbox"));
    }
  }

  @Test
  void failedSaveDoesNotMarkUsedAndRetryDoesNotAddAnotherItem() throws Exception {
    try (Fixture f = new Fixture()) {
      f.register();
      f.failSave = true;
      assertTrue(BridgeRewards.handle(f.client, CODE));
      assertEquals("PENDING", BridgeRewards.status(ID).get("status"));
      assertEquals(1, f.inventory.list().size());
      assertEquals(0, f.scalar("SELECT COUNT(*) FROM saved_items"));
      assertEquals(0, f.scalar("SELECT COUNT(*) FROM card_bridge_outbox"));
      f.failSave = false;
      assertTrue(BridgeRewards.handle(f.client, CODE));
      assertEquals("USED", BridgeRewards.status(ID).get("status"));
      assertEquals(1, f.inventory.list().size());
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM saved_items"));
    }
  }

  @Test
  void petRetryKeepsOneCashItemAndItsThirtyDayExpiration() throws Exception {
    try (Fixture f = new Fixture();
        MockedStatic<CashShop> factory = mockStatic(CashShop.class)) {
      int item = 5000034;
      Item reward = new Item(item, (short) 0, (short) 1, -1);
      String code = "C01" + CODE;
      when(f.items.isCash(item)).thenReturn(true);
      factory.when(() -> CashShop.generateCouponItem(item, (short) 1)).thenReturn(reward);
      BridgeRewards.register(ID, 1, code, item, 1, 30, 1);
      long before = System.currentTimeMillis();
      f.failSave = true;
      assertTrue(BridgeRewards.handle(f.client, code));
      assertEquals("PENDING", BridgeRewards.status(ID).get("status"));
      assertEquals(1, f.cashInventory.size());
      assertEquals(0, f.scalar("SELECT COUNT(*) FROM saved_cash_items"));
      long lifetime = java.util.concurrent.TimeUnit.DAYS.toMillis(30);
      assertTrue(reward.getExpiration() >= before + lifetime);
      assertTrue(reward.getExpiration() <= System.currentTimeMillis() + lifetime);
      f.failSave = false;
      assertTrue(BridgeRewards.handle(f.client, code));
      assertEquals("USED", BridgeRewards.status(ID).get("status"));
      assertEquals(1, f.cashInventory.size());
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM saved_cash_items"));
      factory.verify(() -> CashShop.generateCouponItem(item, (short) 1), times(1));
      f.packets.verify(
          () -> PacketCreator.showCouponRedeemedItems(1, 0, 0, List.of(reward), List.of()),
          times(1));
    }
  }

  @Test
  void registrationIsImmutableAndAnotherAccountCannotClaimTheReward() throws Exception {
    try (Fixture f = new Fixture()) {
      f.register();
      f.register();
      assertThrows(
          IllegalArgumentException.class,
          () -> BridgeRewards.register(ID, 2, CODE, 4031757, 1, 0, 1));
      when(f.client.getAccID()).thenReturn(2);
      assertTrue(BridgeRewards.handle(f.client, CODE));
      assertEquals("READY", BridgeRewards.status(ID).get("status"));
      assertEquals(0, f.inventory.list().size());
    }
  }

  @Test
  void eachCashTypePaysIndependentlyAndReceiptKeepsTheSelection() throws Exception {
    try (Fixture f = new Fixture()) {
      BridgeWallet.change(1, 2, 5000);
      BridgeWallet.change(1, 4, 7000);
      assertEquals(4000, BridgeWallet.debit("c".repeat(64), 1, 1000, 2).get("balance"));
      assertEquals(6000, BridgeWallet.debit("d".repeat(64), 1, 1000, 4).get("balance"));
      assertEquals(10000, BridgeWallet.read(1, 1));
      assertThrows(
          IllegalArgumentException.class, () -> BridgeWallet.debit("c".repeat(64), 1, 1000, 4));
      assertThrows(BridgeHttp.Problem.class, () -> BridgeWallet.debit("e".repeat(64), 1, 5000, 2));
      assertEquals(4000, BridgeWallet.read(1, 2));
      assertEquals(6000, BridgeWallet.read(1, 4));
      assertEquals(
          2,
          f.scalar(
              "SELECT cash_type FROM card_bridge_payments WHERE order_id='"
                  + "c".repeat(64)
                  + "'"));
    }
  }

  @Test
  void nativeSessionsResolveOnlyTheSavedAccountAndExpireOrRevoke() throws Exception {
    try (Fixture f = new Fixture()) {
      String token = "a".repeat(64);
      var person = BridgeSessions.login("Collector", "password", token);
      assertEquals(1, person.get("accountId"));
      assertEquals(person, BridgeSessions.session(token));
      assertThrows(
          BridgeHttp.Problem.class,
          () -> BridgeSessions.login("Collector", "wrong", "b".repeat(64)));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM card_bridge_sessions"));
      BridgeSessions.logout(token);
      assertThrows(BridgeHttp.Problem.class, () -> BridgeSessions.session(token));
      assertTrue(
          BridgeSessions.passwordMatches(
              "password", tools.BCrypt.hashpw("password", tools.BCrypt.gensalt(4))));
      assertFalse(
          BridgeSessions.passwordMatches(
              "wrong", tools.BCrypt.hashpw("password", tools.BCrypt.gensalt(4))));
    }
  }

  @Test
  void authoritativeWalletDebitsOnceAndRejectsChangedTermsOrOverdraft() throws Exception {
    try (Fixture f = new Fixture()) {
      String order = "a".repeat(64);
      assertEquals(9000, BridgeWallet.debit(order, 1, 1000).get("balance"));
      assertEquals(9000, BridgeWallet.debit(order, 1, 1000).get("balance"));
      assertEquals(9000, BridgeWallet.read(1, 1));
      assertThrows(IllegalArgumentException.class, () -> BridgeWallet.debit(order, 1, 2000));
      assertThrows(BridgeHttp.Problem.class, () -> BridgeWallet.debit("b".repeat(64), 1, 10000));
      assertEquals(9000, BridgeWallet.read(1, 1));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM card_bridge_payments"));
      BridgeWallet.change(1, 1, 500);
      assertEquals(9500, BridgeWallet.read(1, 1));
    }
  }
}
