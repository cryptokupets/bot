import { ObjectID } from "mongodb";
import { createQuery } from "odata-v4-mongodb";
import { ODataController, Edm, odata, ODataQuery } from "odata-v4-server";
import { Expert } from "../models/Expert";
import { Trader } from "../models/Trader";
import { Ticker } from "../models/Ticker";
import { Balance } from "../models/Balance";
import { Portfolio } from "../models/Portfolio";
import { Order } from "../models/Order";
import connect from "../connect";
const exchange = require('../../../exchange'); // заменить на TS

const collectionName = "trader";

@odata.type(Trader)
@Edm.EntitySet("Traders")
export class TraderController extends ODataController {
  async get(@odata.query query: ODataQuery): Promise<Trader[]> {
    const db = await connect();
    const mongodbQuery = createQuery(query);
    if (typeof mongodbQuery.query._id == "string") mongodbQuery.query._id = new ObjectID(mongodbQuery.query._id);
    let result = typeof mongodbQuery.limit == "number" && mongodbQuery.limit === 0 ? [] : await db.collection(collectionName)
      .find(mongodbQuery.query)
      .project(mongodbQuery.projection)
      .skip(mongodbQuery.skip || 0)
      .limit(mongodbQuery.limit || 0)
      .sort(mongodbQuery.sort)
      .toArray();//TODO заменить на поток
    if (mongodbQuery.inlinecount) {
      (<any>result).inlinecount = await db.collection(collectionName)
        .find(mongodbQuery.query)
        .project(mongodbQuery.projection)
        .count(false);
    }
    return result;
  }

  @odata.GET
  async getById(@odata.key key: string, @odata.query query: ODataQuery): Promise<Trader> {
    const db = await connect();
    const mongodbQuery = createQuery(query);
    // console.log(query // на самом деле обращение должно происходить к движку
    // этот движок должен кэшировать сохраненный объект, ловить все изменения к нему
    // этот движок должен самостоятельно взаимодействовать с другими API
    // движок сам понимает в каком состоянии он находится и какие данные возвращать
    // самы выбирает способ получения данных, кэшировать их или нет и т.п.
    // движок снимет проблему синхорнизации запросов
    const keyId = new ObjectID(key);
    const { projection } = mongodbQuery;
    projection.currency = 1;
    projection.asset = 1;
    projection.user = 1;
    projection.pass = 1;

    const trader = new Trader(await db.collection(collectionName).findOne({ _id: keyId }, { projection }));
    trader.Order = await new Promise<Order>(resolve => {
      exchange.getOrders(trader, (err, orders: any[]) => {
        resolve(orders.length ? orders[0] : undefined);
      });
    });
    return trader;
  }

  @odata.POST
  async post(@odata.body data: any): Promise<Trader> {
    const db = await connect();
    // const trader = new Trader(data); // добавить проверку входящих данных на соответствие типам
    // никогда не доверяй внешним входящим данным!!!
    if (data.expertId) data.expertId = new ObjectID(data.expertId);
    const { historyId } = await db.collection("expert").findOne({ _id: data.expertId });
    const { currency, asset } = await db.collection("history").findOne({ _id: historyId });
    data.currency = currency;
    data.asset = asset;
  
    return db.collection(collectionName).insertOne(data).then((result) => {
      data._id = result.insertedId;
      return new Trader(data);
    });
  }

  @odata.DELETE
  async delete(@odata.key key: string): Promise<number> {
    const db = await connect();
    let keyId;
    try { keyId = new ObjectID(key); } catch(err) { keyId = key; }
    return await db.collection(collectionName).deleteOne({_id: keyId}).then(result => result.deletedCount);
  }

  @odata.GET("Ticker")
  async getTicker(@odata.result result: any): Promise<Ticker> {
    const { currency, asset } = result;
    return await new Promise<Ticker>(resolve => {
      exchange.getTicker({
        currency,
        asset
      }, (err, ticker) => {
        resolve(new Ticker(ticker));
      });
    });
  }

  @odata.GET("Balance")
  async getBalance(@odata.result result: any): Promise<Balance> {
    const { currency, asset } = result;
    const _id = new ObjectID(result._id);
    const db = await connect();
    const { user, pass } = await db.collection(collectionName).findOne({ _id });
    return await new Promise<Balance>(resolve => {
      exchange.getPortfolio({ user, pass }, (err, portfolio: Portfolio[]) => {
        const balance = portfolio.find(e => e.currency === currency);
        const balanceAsset = portfolio.find(e => e.currency === asset);
        resolve(new Balance({
          available: balance ? balance.available : 0,
          availableAsset: balanceAsset ? balanceAsset.available : 0
        }));
      });
    });
  }

  @odata.GET("Orders")
  async getOrders(@odata.result result: any): Promise<Order[]> {
    const { currency, asset } = result;
    const _id = new ObjectID(result._id);
    const db = await connect();
    const { user, pass } = await db.collection(collectionName).findOne({ _id });
    return await new Promise<Order[]>(resolve => {
      exchange.getOrders({ currency, asset, user, pass }, (err, orders: Order[]) => {
        resolve(orders);
      });
    });
  }

  // @odata.GET("Order")
  // async getOrder(@odata.result result: any): Promise<Order> {
  //   const { currency, asset } = result;
  //   const _id = new ObjectID(result._id);
  //   const db = await connect();
  //   const { user, pass } = await db.collection(collectionName).findOne({ _id });
  //   return await new Promise<Order>(resolve => {
  //     exchange.getOrders({ currency, asset, user, pass }, (err, orders: any[]) => {
  //       resolve(orders.length ? orders[0] : undefined);
  //     });
  //   });
  // }

  @odata.GET("Expert")
  async getExpert(@odata.result result: any, @odata.query query: ODataQuery): Promise<Expert> {
    const db = await connect();
    const mongodbQuery = createQuery(query);
    const expertId = new ObjectID(result.expertId);
    return await db.collection("expert").findOne({ _id: expertId }, {
      fields: mongodbQuery.projection
    });
  }
}
