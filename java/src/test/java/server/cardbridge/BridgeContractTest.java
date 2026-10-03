package server.cardbridge;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import client.Character;
import client.Client;
import client.Ring;
import client.inventory.*;
import client.inventory.manipulator.CashIdGenerator;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import net.packet.InPacket;
import net.server.PlayerStorage;
import net.server.channel.Channel;
import net.server.channel.handlers.CashOperationHandler;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import server.CashShop;
import server.ItemInformationProvider;
import service.NoteService;
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
    boolean loseCommitAcknowledgement;
    boolean loseNativeCommitAcknowledgement;
    int commitAcknowledgementsToLose;

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
      when(chr.getAccountID()).thenReturn(1);
      when(chr.getName()).thenReturn("Collector");
      when(cashShop.getCash(anyInt())).thenAnswer(i -> BridgeWallet.read(1, i.getArgument(0)));
      doAnswer(
              i -> {
                cashInventory.remove(i.getArgument(0));
                return null;
              })
          .when(cashShop)
          .removeFromInventory(any());
      doAnswer(
              i -> {
                Connection con = i.getArgument(0);
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
                return null;
              })
          .when(cashShop)
          .save(any());
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
        st.execute(
            "CREATE TABLE rings(id INT PRIMARY KEY,itemid INT,partnerRingId INT,partnerChrId"
                + " INT,partnername VARCHAR(13))");
        st.execute(
            "CREATE TABLE gifts(id INT AUTO_INCREMENT PRIMARY KEY,`to` INT,`from`"
                + " VARCHAR(13),message VARCHAR(255),sn INT,ringid INT)");
        st.execute(
            "CREATE TABLE namechanges(characterid INT,old VARCHAR(13),new"
                + " VARCHAR(13),completionTime TIMESTAMP)");
        st.execute(
            "CREATE TABLE worldtransfers(characterid INT,`from` INT,`to` INT,completionTime"
                + " TIMESTAMP)");
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
                    if (loseCommitAcknowledgement)
                      throw new SQLException("Injected lost commit acknowledgement");
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
      Connection actual = DriverManager.getConnection(url);
      if (!loseNativeCommitAcknowledgement && commitAcknowledgementsToLose == 0) return actual;
      return (Connection)
          java.lang.reflect.Proxy.newProxyInstance(
              Connection.class.getClassLoader(),
              new Class<?>[] {Connection.class},
              (proxy, method, args) -> {
                try {
                  Object value = method.invoke(actual, args);
                  if (method.getName().equals("commit")
                      && (loseNativeCommitAcknowledgement || commitAcknowledgementsToLose > 0)) {
                    if (commitAcknowledgementsToLose > 0) commitAcknowledgementsToLose--;
                    throw new SQLException("Injected lost database commit acknowledgement");
                  }
                  return value;
                } catch (java.lang.reflect.InvocationTargetException error) {
                  throw error.getCause();
                }
              });
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

  static boolean verifyNonceAt(
      ConcurrentHashMap<String, Long> used, long signedAt, long now, String nonce) {
    String secret = "signature-test-key-".repeat(3), time = Long.toString(signedAt);
    String body = "{}", path = "/wallet";
    return BridgeCrypto.verify(
        secret,
        "POST",
        path,
        time,
        nonce,
        BridgeCrypto.signature(secret, "POST", path, time, nonce, body),
        body,
        used,
        now);
  }

  @Test
  void futureDatedSignatureNonceSurvivesUntilItsInclusiveFinalValidityBoundary() {
    long now = 1790942400000L, signedAt = now + 59000;
    String nonce = "b".repeat(32);
    var used = new ConcurrentHashMap<String, Long>();
    assertTrue(verifyNonceAt(used, signedAt, now, nonce));
    assertFalse(verifyNonceAt(used, signedAt, now, nonce));
    assertFalse(verifyNonceAt(used, signedAt, now + 61000, nonce));
    assertFalse(verifyNonceAt(used, signedAt, signedAt + 60000, nonce));
    assertEquals(signedAt + 60000, used.get(nonce));
    assertFalse(verifyNonceAt(used, signedAt, signedAt + 60001, nonce));
    assertTrue(verifyNonceAt(used, signedAt + 60001, signedAt + 60001, "c".repeat(32)));
    assertFalse(used.containsKey(nonce));
  }

  @Test
  void signatureSkewBoundariesAndOldNonceExpiryRemainExact() {
    long now = 1790942400000L;
    assertTrue(verifyNonceAt(new ConcurrentHashMap<>(), now + 60000, now, "a".repeat(32)));
    assertFalse(verifyNonceAt(new ConcurrentHashMap<>(), now + 60001, now, "a".repeat(32)));
    assertTrue(verifyNonceAt(new ConcurrentHashMap<>(), now - 60000, now, "a".repeat(32)));
    assertFalse(verifyNonceAt(new ConcurrentHashMap<>(), now - 60001, now, "a".repeat(32)));
    String nonce = "d".repeat(32);
    var used = new ConcurrentHashMap<String, Long>();
    assertTrue(verifyNonceAt(used, now - 59000, now, nonce));
    assertFalse(verifyNonceAt(used, now - 59000, now + 1000, nonce));
    assertTrue(verifyNonceAt(used, now + 1001, now + 1001, "e".repeat(32)));
    assertFalse(used.containsKey(nonce));
  }

  @Test
  void nonceCapacityNeverEvictsAStillValidSignatureAndExpiredEntriesReleaseCapacity() {
    long now = 1790942400000L;
    var used = new ConcurrentHashMap<String, Long>();
    for (int i = 0; i < BridgeCrypto.MAX_NONCES; i++) used.put(String.format("%032x", i), now);
    String incoming = "f".repeat(32);
    assertFalse(verifyNonceAt(used, now, now, incoming));
    assertEquals(BridgeCrypto.MAX_NONCES, used.size());
    assertTrue(verifyNonceAt(used, now + 1, now + 1, incoming));
    assertEquals(1, used.size());
  }

  @Test
  void simultaneousValidRequestsCannotGrowTheNonceCacheBeyondItsCap() throws Exception {
    long now = 1790942400000L;
    var used = new ConcurrentHashMap<String, Long>();
    for (int i = 0; i < BridgeCrypto.MAX_NONCES - 1; i++)
      used.put(String.format("%032x", i), now + 60000);
    var executor = java.util.concurrent.Executors.newFixedThreadPool(8);
    var start = new java.util.concurrent.CountDownLatch(1);
    var ready = new java.util.concurrent.CountDownLatch(8);
    List<java.util.concurrent.Future<Boolean>> responses = new ArrayList<>();
    try {
      for (int i = 0; i < 8; i++) {
        String nonce = "f".repeat(31) + Integer.toHexString(i);
        responses.add(
            executor.submit(
                () -> {
                  ready.countDown();
                  start.await();
                  return verifyNonceAt(used, now, now, nonce);
                }));
      }
      assertTrue(ready.await(3, java.util.concurrent.TimeUnit.SECONDS));
      start.countDown();
      int accepted = 0;
      for (var response : responses)
        if (response.get(5, java.util.concurrent.TimeUnit.SECONDS)) accepted++;
      assertEquals(1, accepted);
      assertEquals(BridgeCrypto.MAX_NONCES, used.size());
    } finally {
      start.countDown();
      executor.shutdownNow();
    }
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
  void acknowledgedLostRewardCommitReconcilesIdenticalReceiptWithoutAnotherItem() throws Exception {
    try (Fixture f = new Fixture()) {
      f.register();
      f.loseCommitAcknowledgement = true;
      assertTrue(BridgeRewards.handle(f.client, CODE));
      assertEquals("USED", BridgeRewards.status(ID).get("status"));
      assertTrue(BridgeRewards.hasPending(f.chr));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM saved_items"));
      f.loseCommitAcknowledgement = false;
      f.chr.saveCharToDB(true);
      assertFalse(BridgeRewards.hasPending(f.chr));
      assertEquals(1, f.inventory.list().size());
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM card_bridge_outbox"));
    }
  }

  @Test
  void acknowledgedLostClaimCommitStillDeliversOnceWithinSameProcessEpoch() throws Exception {
    try (Fixture f = new Fixture()) {
      f.register();
      f.commitAcknowledgementsToLose = 1;
      assertTrue(BridgeRewards.handle(f.client, CODE));
      assertEquals("USED", BridgeRewards.status(ID).get("status"));
      assertEquals(1, f.inventory.list().size());
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM saved_items"));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM card_bridge_outbox"));
      assertFalse(BridgeRewards.hasPending(f.chr));
      assertTrue(BridgeRewards.handle(f.client, CODE));
      assertEquals(1, f.inventory.list().size());
    }
  }

  @Test
  void mismatchedUsedReceiptCannotClearClaimOrPersistLaterInventory() throws Exception {
    try (Fixture f = new Fixture()) {
      f.register();
      f.loseCommitAcknowledgement = true;
      assertTrue(BridgeRewards.handle(f.client, CODE));
      try (Connection con = f.connection();
          Statement st = con.createStatement()) {
        st.execute(
            "UPDATE card_bridge_codes SET receipt_id='99999999-9999-4999-8999-999999999999'");
      }
      f.inventory.list().iterator().next().setQuantity((short) 2);
      f.loseCommitAcknowledgement = false;
      f.chr.saveCharToDB(true);
      assertTrue(BridgeRewards.hasPending(f.chr));
      assertEquals(1, f.scalar("SELECT quantity FROM saved_items"));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM card_bridge_outbox"));
    }
  }

  @Test
  void accountResolverRejectsUnknownBannedAndTemporaryBannedAccounts() throws Exception {
    try (Fixture f = new Fixture()) {
      assertEquals(1, BridgeSessions.resolve("Collector", null).get("accountId"));
      assertEquals("Collector", BridgeSessions.resolve(null, 1).get("name"));
      assertThrows(IllegalArgumentException.class, () -> BridgeSessions.resolve("Collector", 1));
      assertThrows(BridgeHttp.Problem.class, () -> BridgeSessions.resolve("Unknown", null));
      try (Connection con = f.connection();
          Statement st = con.createStatement()) {
        st.execute("UPDATE accounts SET banned=1");
        assertThrows(BridgeHttp.Problem.class, () -> BridgeSessions.resolve(null, 1));
        st.execute("UPDATE accounts SET banned=0,tempban=TIMESTAMP '2099-01-01 00:00:00'");
        assertThrows(BridgeHttp.Problem.class, () -> BridgeSessions.resolve(null, 1));
      }
    }
  }

  @Test
  void operatorDiagnosticsAreBoundedAggregatesWithoutCodePayloads() throws Exception {
    try (Fixture f = new Fixture()) {
      f.register();
      f.failSave = true;
      BridgeRewards.handle(f.client, CODE);
      try (Connection con = f.connection();
          PreparedStatement ps =
              con.prepareStatement(
                  "INSERT INTO"
                      + " card_bridge_outbox(receipt_id,payload,attempts,last_attempt,last_error)"
                      + " VALUES(?,?,?,?,?)")) {
        ps.setString(1, "99999999-9999-4999-8999-999999999999");
        ps.setString(2, CODE);
        ps.setInt(3, 4);
        ps.setLong(4, System.currentTimeMillis());
        ps.setString(5, "CALLBACK_UNAVAILABLE");
        ps.executeUpdate();
      }
      Map<String, Object> diagnostic = BridgeRewards.diagnostics();
      assertEquals(1L, diagnostic.get("pendingRewards"));
      assertEquals(1L, diagnostic.get("pendingCallbacks"));
      assertEquals(4L, diagnostic.get("attempts"));
      assertEquals("CALLBACK_UNAVAILABLE", diagnostic.get("lastError"));
      assertFalse(BridgeHttp.JSON.toJson(diagnostic).contains(CODE));
      assertFalse(diagnostic.containsKey("payload"));
    }
  }

  static CashShop.CashItem nativeOffer(int itemId) {
    CashShop.CashItem offer = mock(CashShop.CashItem.class);
    when(offer.isOnSale()).thenReturn(true);
    when(offer.getPrice()).thenReturn(1000);
    when(offer.getItemId()).thenReturn(itemId);
    when(offer.getSN()).thenReturn(50100000);
    Equip item = new Equip(itemId, (short) 0);
    when(offer.toItem()).thenReturn(item);
    return offer;
  }

  static Character partner() {
    Character partner = mock(Character.class);
    when(partner.getId()).thenReturn(8);
    when(partner.getName()).thenReturn("Partner");
    return partner;
  }

  static void handleCrush(Fixture f, CashShop.CashItem offer, int cashType) throws Exception {
    try (MockedStatic<CashShop.CashItemFactory> factory =
        mockStatic(CashShop.CashItemFactory.class)) {
      factory.when(() -> CashShop.CashItemFactory.getItem(50100000)).thenReturn(offer);
      when(f.cashShop.isOpened()).thenReturn(true);
      when(f.client.tryacquireClient()).thenReturn(true);
      when(f.client.checkBirthDate(any())).thenReturn(true);
      Channel channel = mock(Channel.class);
      PlayerStorage storage = mock(PlayerStorage.class);
      when(f.client.getChannelServer()).thenReturn(channel);
      when(channel.getPlayerStorage()).thenReturn(storage);
      Character recipient = partner();
      when(storage.getCharacterByName("Partner")).thenReturn(recipient);
      InPacket packet = mock(InPacket.class);
      when(packet.readByte()).thenReturn((byte) 0x1D);
      when(packet.readInt()).thenReturn(19900101, cashType, 50100000);
      when(packet.readString()).thenReturn("Partner", "A gift");
      new CashOperationHandler(mock(NoteService.class)).handlePacket(packet, f.client);
    }
  }

  @Test
  void patchedNativeHandlerRejectsUnsupportedTypeAndConcurrentWebsiteDebitBeforeDelivery()
      throws Exception {
    try (Fixture f = new Fixture()) {
      CashShop.CashItem offer = nativeOffer(1112000);
      handleCrush(f, offer, 3);
      assertEquals(10000, BridgeWallet.read(1, 1));
      assertEquals(0, f.scalar("SELECT COUNT(*) FROM rings"));
      when(offer.toItem())
          .thenAnswer(
              i -> {
                BridgeWallet.debit("f".repeat(64), 1, 10000, 1);
                return new Equip(1112000, (short) 0);
              });
      handleCrush(f, offer, 1);
      assertEquals(0, BridgeWallet.read(1, 1));
      assertEquals(0, f.cashInventory.size());
      assertEquals(0, f.scalar("SELECT COUNT(*) FROM rings"));
      assertEquals(0, f.scalar("SELECT COUNT(*) FROM gifts"));
      assertEquals(0, f.scalar("SELECT COUNT(*) FROM card_bridge_native_purchases"));
    }
  }

  @Test
  void forgedRingActionRejectsOrdinaryCashEquipAndWrongRingFamilyBeforeItemFactory()
      throws Exception {
    try (Fixture f = new Fixture()) {
      CashShop.CashItem hat = nativeOffer(1003050);
      handleCrush(f, hat, 1);
      verify(hat, never()).toItem();
      assertEquals(10000, BridgeWallet.read(1, 1));
      assertEquals(0, f.scalar("SELECT COUNT(*) FROM rings"));
      assertEquals(0, f.scalar("SELECT COUNT(*) FROM gifts"));
      assertTrue(
          BridgeNativePurchases.ring(
              f.client, 1, hat, partner(), "Gift", true, mock(NoteService.class)));
      verify(hat, never()).toItem();
      CashShop.CashItem friend = nativeOffer(1112800);
      assertTrue(
          BridgeNativePurchases.ring(
              f.client, 1, friend, partner(), "Gift", false, mock(NoteService.class)));
      verify(friend, never()).toItem();
      for (int item : new int[] {1112803, 1112806, 1112807, 1112809, 1112808, 1112100, 5000000}) {
        CashShop.CashItem unrelated = nativeOffer(item);
        assertFalse(BridgeNativePurchases.validRingOffer(unrelated, true));
        assertFalse(BridgeNativePurchases.validRingOffer(unrelated, false));
      }
      f.transport.when(BridgeHttp::enabled).thenReturn(false);
      handleCrush(f, hat, 1);
      verify(hat, never()).toItem();
      verify(f.cashShop, never()).gainCash(anyInt(), anyInt());
      assertEquals(0, f.cashInventory.size());
      assertEquals(0, f.scalar("SELECT COUNT(*) FROM card_bridge_native_purchases"));
    }
  }

  @Test
  void nativeRingDebitBenefitAndInventoryCommitTogetherAndFailureRollsBackAll() throws Exception {
    try (Fixture f = new Fixture();
        MockedStatic<CashIdGenerator> ids = mockStatic(CashIdGenerator.class);
        MockedStatic<Ring> rings = mockStatic(Ring.class)) {
      ids.when(CashIdGenerator::generateCashId).thenReturn(1001, 1002, 1003, 1004);
      CashShop.CashItem offer = nativeOffer(1112000);
      handleCrush(f, offer, 1);
      assertEquals(9000, BridgeWallet.read(1, 1));
      assertEquals(2, f.scalar("SELECT COUNT(*) FROM rings"));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM gifts"));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM saved_cash_items"));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM card_bridge_native_purchases"));
      doThrow(new SQLException("Injected inventory persistence failure"))
          .when(f.cashShop)
          .save(any());
      handleCrush(f, offer, 1);
      assertEquals(9000, BridgeWallet.read(1, 1));
      assertEquals(1, f.cashInventory.size());
      assertEquals(2, f.scalar("SELECT COUNT(*) FROM rings"));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM gifts"));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM card_bridge_native_purchases"));
    }
  }

  @Test
  void nativeRequestsCommitWithPaymentAndRejectedRequestKeepsSelectedWallet() throws Exception {
    try (Fixture f = new Fixture()) {
      BridgeWallet.change(1, 4, 5000);
      CashShop.CashItem offer = nativeOffer(5060000);
      assertTrue(BridgeNativePurchases.request(f.client, offer, "NewName", 0, false));
      assertEquals(4000, BridgeWallet.read(1, 4));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM namechanges"));
      assertTrue(BridgeNativePurchases.request(f.client, offer, "OtherName", 0, false));
      assertEquals(4000, BridgeWallet.read(1, 4));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM namechanges"));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM card_bridge_native_purchases"));
      assertEquals(10000, BridgeWallet.read(1, 1));
    }
  }

  @Test
  void friendshipUsesMaplePointsAndWorldRequestUsesPrepaidWithAtomicRollback() throws Exception {
    try (Fixture f = new Fixture();
        MockedStatic<CashIdGenerator> ids = mockStatic(CashIdGenerator.class);
        MockedStatic<Ring> rings = mockStatic(Ring.class)) {
      ids.when(CashIdGenerator::generateCashId).thenReturn(3001, 3002);
      BridgeWallet.change(1, 2, 2000);
      BridgeWallet.change(1, 4, 2000);
      assertTrue(
          BridgeNativePurchases.ring(
              f.client,
              2,
              nativeOffer(1112800),
              partner(),
              "A gift",
              true,
              mock(NoteService.class)));
      assertEquals(1000, BridgeWallet.read(1, 2));
      assertEquals(10000, BridgeWallet.read(1, 1));
      CashShop.CashItem transfer = nativeOffer(5060001);
      assertTrue(BridgeNativePurchases.request(f.client, transfer, null, 1, true));
      assertEquals(1000, BridgeWallet.read(1, 4));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM worldtransfers"));
      assertEquals(2, f.scalar("SELECT COUNT(*) FROM card_bridge_native_purchases"));
      assertTrue(BridgeNativePurchases.request(f.client, transfer, null, 2, true));
      assertEquals(1000, BridgeWallet.read(1, 4));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM worldtransfers"));
      assertEquals(2, f.scalar("SELECT COUNT(*) FROM card_bridge_native_purchases"));
    }
  }

  @Test
  void nativeAndWebsiteSpendingShareTheSameAccountRowAndCannotOverdraw() throws Exception {
    try (Fixture f = new Fixture();
        Connection nativePurchase = f.connection()) {
      nativePurchase.setAutoCommit(false);
      BridgeNativePurchases.charge(nativePurchase, 1, 1, 8500);
      java.util.concurrent.CountDownLatch started = new java.util.concurrent.CountDownLatch(1);
      java.util.concurrent.ExecutorService executor =
          java.util.concurrent.Executors.newSingleThreadExecutor();
      try {
        var result =
            executor.submit(
                () -> {
                  try (MockedStatic<DatabaseConnection> threadDb =
                      mockStatic(DatabaseConnection.class)) {
                    threadDb
                        .when(DatabaseConnection::getConnection)
                        .thenAnswer(i -> f.connection());
                    started.countDown();
                    return assertThrows(
                            BridgeHttp.Problem.class,
                            () -> BridgeWallet.debit("e".repeat(64), 1, 2000, 1))
                        .code;
                  }
                });
        assertTrue(started.await(3, java.util.concurrent.TimeUnit.SECONDS));
        nativePurchase.commit();
        assertEquals("INSUFFICIENT_FUNDS", result.get(5, java.util.concurrent.TimeUnit.SECONDS));
        assertEquals(1500, BridgeWallet.read(1, 1));
        assertEquals(0, f.scalar("SELECT COUNT(*) FROM card_bridge_payments"));
      } finally {
        executor.shutdownNow();
      }
    }
  }

  @Test
  void nativeAmbiguousCommitUsesDurableReceiptInsteadOfRefundingDeliveredRing() throws Exception {
    try (Fixture f = new Fixture();
        MockedStatic<CashIdGenerator> ids = mockStatic(CashIdGenerator.class);
        MockedStatic<Ring> rings = mockStatic(Ring.class)) {
      ids.when(CashIdGenerator::generateCashId).thenReturn(2001, 2002);
      f.loseNativeCommitAcknowledgement = true;
      handleCrush(f, nativeOffer(1112000), 1);
      assertEquals(9000, BridgeWallet.read(1, 1));
      assertEquals(2, f.scalar("SELECT COUNT(*) FROM rings"));
      assertEquals(1, f.cashInventory.size());
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM saved_cash_items"));
      assertEquals(1, f.scalar("SELECT COUNT(*) FROM card_bridge_native_purchases"));
      ids.verify(() -> CashIdGenerator.freeCashId(anyInt()), never());
    }
  }

  @Test
  void nativeReceiptLookupWaitsForTheExistingAccountTransactionBeforeDeclaringAbsence()
      throws Exception {
    try (Fixture f = new Fixture();
        Connection original = f.connection()) {
      String receipt = "77777777-7777-4777-8777-777777777777";
      original.setAutoCommit(false);
      BridgeNativePurchases.charge(original, 1, 1, 1000);
      try (PreparedStatement ps =
          original.prepareStatement(
              "INSERT INTO card_bridge_native_purchases VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)")) {
        ps.setString(1, receipt);
        ps.setInt(2, 1);
        ps.setInt(3, 7);
        ps.setInt(4, 1);
        ps.setInt(5, 1000);
        ps.setString(6, "crush");
        ps.executeUpdate();
      }
      java.util.concurrent.CountDownLatch started = new java.util.concurrent.CountDownLatch(1);
      java.util.concurrent.ExecutorService executor =
          java.util.concurrent.Executors.newSingleThreadExecutor();
      try {
        var result =
            executor.submit(
                () -> {
                  try (MockedStatic<DatabaseConnection> threadDb =
                      mockStatic(DatabaseConnection.class)) {
                    threadDb
                        .when(DatabaseConnection::getConnection)
                        .thenAnswer(i -> f.connection());
                    started.countDown();
                    return BridgeNativePurchases.receiptExists(receipt, 1, 7, 1, 1000, "crush");
                  }
                });
        assertTrue(started.await(3, java.util.concurrent.TimeUnit.SECONDS));
        assertThrows(
            java.util.concurrent.TimeoutException.class,
            () -> result.get(200, java.util.concurrent.TimeUnit.MILLISECONDS));
        original.commit();
        assertTrue(result.get(5, java.util.concurrent.TimeUnit.SECONDS));
        assertEquals(9000, BridgeWallet.read(1, 1));
      } finally {
        executor.shutdownNow();
      }
    }
  }

  @Test
  void nativeReceiptReconciliationRejectsChangedTermsAndMissingAccount() throws Exception {
    try (Fixture f = new Fixture();
        Connection con = f.connection();
        Statement st = con.createStatement()) {
      String receipt = "77777777-7777-4777-8777-777777777777";
      st.execute(
          "INSERT INTO card_bridge_native_purchases VALUES('"
              + receipt
              + "',1,7,1,1000,'crush',CURRENT_TIMESTAMP)");
      assertTrue(BridgeNativePurchases.receiptExists(receipt, 1, 7, 1, 1000, "crush"));
      assertThrows(
          SQLException.class,
          () -> BridgeNativePurchases.receiptExists(receipt, 1, 7, 4, 1000, "crush"));
      assertThrows(
          SQLException.class,
          () -> BridgeNativePurchases.receiptExists(receipt, 1, 8, 1, 1000, "crush"));
      assertThrows(
          SQLException.class,
          () -> BridgeNativePurchases.receiptExists(receipt, 1, 7, 1, 1000, "friendship"));
      assertThrows(
          SQLException.class,
          () -> BridgeNativePurchases.receiptExists(receipt, 2, 7, 1, 1000, "crush"));
      assertFalse(
          BridgeNativePurchases.receiptExists(
              "88888888-8888-4888-8888-888888888888", 1, 7, 1, 1000, "crush"));
    }
  }

  @Test
  void bridgeDisabledRingChargesBeforeCreatingBenefitAndRefundsRejectedRing() throws Exception {
    try (Fixture f = new Fixture();
        MockedStatic<Ring> rings = mockStatic(Ring.class)) {
      f.transport.when(BridgeHttp::enabled).thenReturn(false);
      java.util.concurrent.atomic.AtomicInteger delta =
          new java.util.concurrent.atomic.AtomicInteger();
      doAnswer(
              i -> {
                delta.addAndGet(i.getArgument(1));
                return null;
              })
          .when(f.cashShop)
          .gainCash(anyInt(), anyInt());
      rings
          .when(() -> Ring.createRing(anyInt(), any(), any()))
          .thenAnswer(
              i -> {
                assertEquals(-1000, delta.get());
                return new tools.Pair<>(-1, -1);
              });
      handleCrush(f, nativeOffer(1112000), 1);
      assertEquals(0, delta.get());
      assertEquals(0, f.cashInventory.size());
      assertEquals(0, f.scalar("SELECT COUNT(*) FROM rings"));
    }
  }

  @Test
  void nativeTransactionCannotPersistAnUnfinishedCodeRewardOutsideItsUsedTransaction()
      throws Exception {
    try (Fixture f = new Fixture()) {
      f.register();
      f.failSave = true;
      assertTrue(BridgeRewards.handle(f.client, CODE));
      assertEquals("PENDING", BridgeRewards.status(ID).get("status"));
      handleCrush(f, nativeOffer(1112000), 1);
      assertEquals(10000, BridgeWallet.read(1, 1));
      assertEquals(0, f.scalar("SELECT COUNT(*) FROM card_bridge_native_purchases"));
    }
  }

  @Test
  void lostLeaseFailsClosedAndRequestsOnlyOneProcessRestart() throws Exception {
    var leaseField = BridgeHttp.class.getDeclaredField("lease");
    leaseField.setAccessible(true);
    var lostField = BridgeHttp.class.getDeclaredField("leaseLost");
    lostField.setAccessible(true);
    var oldTerminate = BridgeHttp.terminate;
    Connection lease = mock(Connection.class);
    Statement statement = mock(Statement.class);
    ResultSet result = mock(ResultSet.class);
    when(lease.createStatement()).thenReturn(statement);
    when(statement.executeQuery(anyString())).thenReturn(result);
    when(result.next()).thenReturn(true);
    when(result.getInt(1)).thenReturn(1, 0);
    java.util.concurrent.atomic.AtomicInteger exits =
        new java.util.concurrent.atomic.AtomicInteger();
    BridgeHttp.terminate =
        code -> {
          assertEquals(75, code);
          exits.incrementAndGet();
        };
    leaseField.set(null, lease);
    lostField.setBoolean(null, false);
    try {
      BridgeHttp.requireLease();
      assertThrows(SQLException.class, BridgeHttp::requireLease);
      assertThrows(SQLException.class, BridgeHttp::requireLease);
      assertEquals(1, exits.get());
    } finally {
      BridgeHttp.terminate = oldTerminate;
      leaseField.set(null, null);
      lostField.setBoolean(null, false);
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
  void fullOrdinaryAndCashInventoriesLeaveTheCodeReadyWithoutPartialGrant() throws Exception {
    try (Fixture f = new Fixture()) {
      f.register();
      for (int i = 0; i < 16; i++)
        f.inventory.addItem(new Item(4030000 + i, (short) 0, (short) 1, -1));
      assertTrue(BridgeRewards.handle(f.client, CODE));
      assertEquals("READY", BridgeRewards.status(ID).get("status"));
      assertEquals(16, f.inventory.list().size());
      assertEquals(0, f.scalar("SELECT COUNT(*) FROM card_bridge_outbox"));
    }
    try (Fixture f = new Fixture()) {
      int item = 5000034;
      when(f.items.isCash(item)).thenReturn(true);
      BridgeRewards.register(ID, 1, "C01" + CODE, item, 1, 30, 1);
      when(f.cashShop.getItemsSize()).thenReturn(100);
      assertTrue(BridgeRewards.handle(f.client, "C01" + CODE));
      assertEquals("READY", BridgeRewards.status(ID).get("status"));
      assertEquals(0, f.cashInventory.size());
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
