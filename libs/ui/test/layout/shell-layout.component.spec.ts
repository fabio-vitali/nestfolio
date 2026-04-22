import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { ShellLayoutComponent } from '../../src/layout/shell-layout.component';

@Component({
  standalone: true,
  imports: [ShellLayoutComponent],
  template: `
    <nf-shell-layout>
      <button nfHeaderActions data-testid="projected-action">Go</button>
      <div data-testid="projected-body">body content</div>
    </nf-shell-layout>
  `,
})
class HostComponent {}

describe('ShellLayoutComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('projects [nfHeaderActions] content into the header actions area', () => {
    const header = fixture.nativeElement.querySelector('.nf-header-actions');
    expect(header).toBeTruthy();
    const action = header.querySelector('[data-testid="projected-action"]');
    expect(action).toBeTruthy();
  });

  it('projects default (unslotted) content into the main shell body', () => {
    const main = fixture.nativeElement.querySelector('.shell-content');
    expect(main).toBeTruthy();
    const body = main.querySelector('[data-testid="projected-body"]');
    expect(body).toBeTruthy();
  });

  it('does not leak the named-slot element into the main shell body', () => {
    const main = fixture.nativeElement.querySelector('.shell-content');
    expect(main.querySelector('[data-testid="projected-action"]')).toBeFalsy();
  });
});
