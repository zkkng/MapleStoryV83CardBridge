package server.cardbridge;

import client.Character;
import client.Client;
import client.Ring;
import client.inventory.Equip;
import client.inventory.Item;
import client.inventory.manipulator.CashIdGenerator;
import config.YamlConfig;
import java.sql.*;
import java.util.Set;
import java.util.UUID;
import server.CashShop;
import server.CashShop.CashItem;
import service.NoteService;
import tools.DatabaseConnection;
import tools.PacketCreator;

/** Atomically saves native ring/request benefits and their authoritative cash charge. */
public final class BridgeNativePurchases {
  private BridgeNativePurchases() {}

  private static final Set<Integer> CRUSH_RING_ITEMS =
      Set.of(1112000, 1112001, 1112002, 1112003, 1112005, 1112006, 1112007, 1112012);
  private static final Set<Integer> FRIENDSHIP_RING_ITEMS =
      Set.of(1112800, 1112801, 1112802, 1112810, 1112811, 1112812);

  private static long lastFailureLog;

  private static synchronized void failureLog() {
    long now = System.currentTimeMillis();
    if (now - lastFailureLog >= 60000) {
      lastFailureLog = now;
      System.err.println("card_bridge: NATIVE_PURCHASE_REJECTED; no cash or benefit committed");
    }
  }

  public static boolean supportedCash(int type) {
    return type == 1 || type == 2 || type == 4;
  }

  public static boolean validRingOffer(CashItem offer, boolean friendship) {
    if (offer == null) return false;
    return (friendship ? FRIENDSHIP_RING_ITEMS : CRUSH_RING_ITEMS).contains(offer.getItemId());
  }

  public static boolean ring(
      Client c,
      int type,
      CashItem offer,
      Character partner,
      String message,
      boolean friendship,
      NoteService notes) {
    if (!BridgeHttp.enabled()) return false;
    boolean completed =
        purchase(c, type, offer, friendship ? "friendship" : "crush", partner, message, 0);
    // Gifts are durable with the purchase. A notification failure cannot undo delivery.
    try {
      if (completed) {
        notes.sendWithFame(message, c.getPlayer().getName(), partner.getName());
        notes.show(partner);
      }
    } catch (Exception ignored) {
      System.err.println("card_bridge: RING_NOTIFICATION_UNAVAILABLE");
    }
    return true;
  }

  public static boolean request(
      Client c, CashItem offer, String name, int world, boolean transfer) {
    if (!BridgeHttp.enabled()) return false;
    purchase(c, 4, offer, transfer ? "world" : "name", null, name, world);
    return true;
  }

  static void charge(Connection con, int account, int type, int amount) throws SQLException {
    if (!supportedCash(type) || amount < 1 || amount > 100000000)
      throw new IllegalArgumentException("Invalid native cash purchase");
    String column =
        switch (type) {
          case 1 -> "nxCredit";
          case 2 -> "maplePoint";
          default -> "nxPrepaid";
        };
    try (PreparedStatement ps =
        con.prepareStatement(
            "UPDATE accounts SET "
                + column
                + "=COALESCE("
                + column
                + ",0)-? WHERE id=? AND banned=0"
                + " AND tempban<=UTC_TIMESTAMP() AND COALESCE("
                + column
                + ",0)>=?")) {
      ps.setInt(1, amount);
      ps.setInt(2, account);
      ps.setInt(3, amount);
      if (ps.executeUpdate() != 1)
        throw new BridgeHttp.Problem(
            409, "INSUFFICIENT_FUNDS", "The selected cash balance is too low.");
    }
  }

  static boolean receiptExists(
      String receipt, int account, int character, int cashType, int amount, String kind)
      throws SQLException {
    try (Connection con = DatabaseConnection.getConnection()) {
      con.setNetworkTimeout(Runnable::run, 5000);
      con.setAutoCommit(false);
      try {
        // The original debit holds this existing row until its complete transaction
        // resolves. A lookup of a newly inserted receipt alone cannot prove absence.
        try (PreparedStatement accountLock =
            con.prepareStatement("SELECT id FROM accounts WHERE id=? FOR UPDATE")) {
          accountLock.setQueryTimeout(5);
          accountLock.setInt(1, account);
          try (ResultSet rs = accountLock.executeQuery()) {
            if (!rs.next()) throw new SQLException("Native purchase account cannot be reconciled");
          }
        }
        try (PreparedStatement ps =
            con.prepareStatement(
                "SELECT account_id,character_id,cash_type,amount,kind FROM"
                    + " card_bridge_native_purchases WHERE receipt_id=? FOR UPDATE")) {
          ps.setQueryTimeout(5);
          ps.setString(1, receipt);
          try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) return false;
            if (rs.getInt(1) != account
                || rs.getInt(2) != character
                || rs.getInt(3) != cashType
                || rs.getInt(4) != amount
                || !kind.equals(rs.getString(5)))
              throw new SQLException("Native purchase receipt identity conflict");
            return true;
          }
        }
      } finally {
        // Reconciliation reads only; release the account lock without another commit.
        con.rollback();
      }
    }
  }

  private static boolean purchase(
      Client c, int type, CashItem offer, String kind, Character partner, String text, int world) {
    Character chr = c.getPlayer();
    synchronized (chr) {
      CashShop shop = chr.getCashShop();
      Item delivered = null;
      int left = -1, right = -1;
      boolean committed = false;
      String receipt = UUID.randomUUID().toString();
      try {
        BridgeHttp.requireLease();
        if (!supportedCash(type)
            || offer == null
            || !offer.isOnSale()
            || offer.getPrice() < 1
            || offer.getPrice() > 100000000
            || shop.getItemsSize() >= 100
            || BridgeRewards.hasPending(chr))
          throw new IllegalArgumentException("Invalid native purchase");
        boolean ring = kind.equals("crush") || kind.equals("friendship");
        if (ring && !validRingOffer(offer, kind.equals("friendship")))
          throw new IllegalArgumentException("Invalid ring offer family");
        delivered = offer.toItem();
        if (ring
            && (partner == null || partner.getId() == chr.getId() || !(delivered instanceof Equip)))
          throw new IllegalArgumentException("Invalid ring recipient or item");
        try (Connection con = DatabaseConnection.getConnection()) {
          con.setAutoCommit(false);
          try {
            // Lock the account before issuing any persisted benefit. Website and native
            // charges contend on this same row; a stale balance preview grants nothing.
            charge(con, c.getAccID(), type, offer.getPrice());
            if (ring) {
              left = CashIdGenerator.generateCashId();
              right = CashIdGenerator.generateCashId();
              insertRing(con, left, right, offer.getItemId(), partner);
              insertRing(con, right, left, offer.getItemId(), chr);
              ((Equip) delivered).setRingId(left);
              try (PreparedStatement ps =
                  con.prepareStatement("INSERT INTO gifts VALUES(DEFAULT,?,?,?,?,?)")) {
                ps.setInt(1, partner.getId());
                ps.setString(2, chr.getName());
                ps.setString(3, text);
                ps.setInt(4, offer.getSN());
                ps.setInt(5, right);
                ps.executeUpdate();
              }
            } else {
              insertRequest(con, chr, kind, text, world);
            }
            shop.addToInventory(delivered);
            shop.save(con);
            try (PreparedStatement ps =
                con.prepareStatement(
                    "INSERT INTO card_bridge_native_purchases"
                        + " VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)")) {
              ps.setString(1, receipt);
              ps.setInt(2, c.getAccID());
              ps.setInt(3, chr.getId());
              ps.setInt(4, type);
              ps.setInt(5, offer.getPrice());
              ps.setString(6, kind);
              ps.executeUpdate();
            }
            BridgeHttp.requireLease();
            try {
              con.commit();
              committed = true;
            } catch (SQLException uncertain) {
              // Close the failed connection before querying the independent durable receipt.
              try {
                con.close();
              } catch (SQLException ignored) {
                /* Verify the durable receipt independently. */
              }
              try {
                committed =
                    receiptExists(receipt, c.getAccID(), chr.getId(), type, offer.getPrice(), kind);
              } catch (SQLException unavailable) {
                BridgeHttp.uncertainCommit();
              }
              if (!committed) throw uncertain;
            }
          } catch (Exception error) {
            if (!committed && !con.isClosed()) con.rollback();
            throw error;
          }
        }
      } catch (Exception error) {
        if (!committed) {
          if (delivered != null) shop.removeFromInventory(delivered);
          if (left >= 0) CashIdGenerator.freeCashId(left);
          if (right >= 0) CashIdGenerator.freeCashId(right);
          failureLog();
          c.sendPacket(PacketCreator.showCashShopMessage((byte) 0));
          c.enableCSActions();
          return false;
        }
      }
      // Notifications occur only after the durable inventory, request and debit commit.
      if (kind.equals("name")) {
        chr.bridgeNameChangePending();
        c.sendPacket(PacketCreator.showNameChangeSuccess(delivered, c.getAccID()));
      } else if (kind.equals("world")) {
        c.sendPacket(PacketCreator.showWorldTransferSuccess(delivered, c.getAccID()));
      } else {
        if (kind.equals("friendship")) {
          chr.addFriendshipRing(Ring.loadFromDb(left));
          c.sendPacket(
              PacketCreator.showBoughtCashRing(delivered, partner.getName(), c.getAccID()));
        } else {
          chr.addCrushRing(Ring.loadFromDb(left));
          c.sendPacket(PacketCreator.showBoughtCashItem(delivered, c.getAccID()));
        }
      }
      c.sendPacket(PacketCreator.showCash(chr));
      c.enableCSActions();
      return true;
    }
  }

  private static void insertRing(Connection con, int id, int other, int item, Character partner)
      throws SQLException {
    try (PreparedStatement ps =
        con.prepareStatement(
            "INSERT INTO rings(id,itemid,partnerRingId,partnerChrId,partnername)"
                + " VALUES(?,?,?,?,?)")) {
      ps.setInt(1, id);
      ps.setInt(2, item);
      ps.setInt(3, other);
      ps.setInt(4, partner.getId());
      ps.setString(5, partner.getName());
      ps.executeUpdate();
    }
  }

  private static void insertRequest(
      Connection con, Character chr, String kind, String name, int world) throws SQLException {
    boolean transfer = kind.equals("world");
    String table = transfer ? "worldtransfers" : "namechanges";
    long cooldown =
        transfer
            ? YamlConfig.config.server.WORLD_TRANSFER_COOLDOWN
            : YamlConfig.config.server.NAME_CHANGE_COOLDOWN;
    try (PreparedStatement ps =
        con.prepareStatement(
            "SELECT completionTime FROM " + table + " WHERE characterid=? FOR UPDATE")) {
      ps.setInt(1, chr.getId());
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          Timestamp completed = rs.getTimestamp(1);
          if (completed == null || completed.getTime() + cooldown > System.currentTimeMillis())
            throw new IllegalArgumentException("Request already pending or on cooldown");
        }
      }
    }
    try (PreparedStatement ps =
        con.prepareStatement(
            transfer
                ? "INSERT INTO worldtransfers(characterid,`from`,`to`) VALUES(?,?,?)"
                : "INSERT INTO namechanges(characterid,old,new) VALUES(?,?,?)")) {
      ps.setInt(1, chr.getId());
      if (transfer) {
        ps.setInt(2, chr.getWorld());
        ps.setInt(3, world);
      } else {
        ps.setString(2, chr.getName());
        ps.setString(3, name);
      }
      ps.executeUpdate();
    }
  }
}
