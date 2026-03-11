import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { of } from 'rxjs';
import { TradesTableComponent } from '../../../src/app/decision/trades-table.component';
import type { ProposedAction } from '../../../src/app/stores/advisory.store';

class FakeLoader implements TranslateLoader {
  getTranslation() {
    return of({});
  }
}

@Component({
  standalone: true,
  imports: [TradesTableComponent],
  template: `<app-trades-table [trades]="trades" />`,
})
class TestHostComponent {
  trades: ProposedAction[] = [
    { actionType: 'MARKET', symbol: 'VWCE.DE', side: 'BUY', quantity: 10, limitPrice: null, currency: 'EUR' },
    { actionType: 'LIMIT', symbol: 'AGGH.L', side: 'SELL', quantity: 5, limitPrice: 2500, currency: 'EUR' },
  ];
}

describe('TradesTableComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        TestHostComponent,
        TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: FakeLoader } }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  it('should render trade rows', () => {
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
  });

  it('should display symbol', () => {
    const cells = fixture.nativeElement.querySelectorAll('.symbol-cell');
    expect(cells[0].textContent).toBe('VWCE.DE');
    expect(cells[1].textContent).toBe('AGGH.L');
  });

  it('should apply side-buy class for BUY', () => {
    const tags = fixture.nativeElement.querySelectorAll('.side-tag');
    expect(tags[0].classList).toContain('side-buy');
  });

  it('should apply side-sell class for SELL', () => {
    const tags = fixture.nativeElement.querySelectorAll('.side-tag');
    expect(tags[1].classList).toContain('side-sell');
  });

  it('should display quantity', () => {
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('10');
  });
});
