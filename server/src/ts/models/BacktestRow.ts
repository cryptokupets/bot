import { ObjectID } from "mongodb";
import { Edm } from "odata-v4-server";
import { Candle } from "./Candle";

export class BacktestRow {
  @Edm.Key
  @Edm.Computed
  @Edm.String
  public _id: ObjectID

  @Edm.DateTimeOffset
  public time: number;

  @Edm.Double
  public open: number;

  @Edm.Double
  public high: number;

  @Edm.Double
  public low: number;

  @Edm.Double
  public close: number;

  @Edm.Int32
  public advice: number

  @Edm.Double
  public balanceFrom: number

  @Edm.Double
  public balanceTo: number

  @Edm.Double
  public balanceEstimate: number

  @Edm.String
  public backtestId: ObjectID

  constructor (jsonData: any) {
    Object.assign(this, jsonData);
  }
}
